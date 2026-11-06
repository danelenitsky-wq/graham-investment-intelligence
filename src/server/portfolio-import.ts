import "server-only";
import { createHash } from "node:crypto";
import type { AssetType, Prisma } from "@/generated/prisma/client";
import { stableStringify } from "@/lib/decision/snapshot";
import {
  hasErrors,
  mergeDrafts,
  validateHoldingRows,
  type HoldingDraft,
  type MergedHolding,
  type RawHoldingRow,
  type RowIssue,
  type ValidatedRow,
} from "@/lib/portfolio/import/validate";
import { db } from "./db";
import { getDefaultPortfolio } from "./portfolio";
import { ensureDefaultAlerts } from "./alerts";

export const USER_ENTERED_SOURCE_KEY = "user-entered";

export type ImportKind = "CSV" | "MANUAL" | "PDF_STATEMENT";

export interface ResolvedHolding extends MergedHolding {
  securityId: string | null;
  securityName: string | null;
  resolution: "EXISTING" | "CREATE_USER_ENTERED";
  existingPosition: { quantity: number; averageCost: number; currency: string } | null;
  /** Position after the import (merged with the existing one). */
  after: { quantity: number; averageCost: number };
  issues: RowIssue[];
}

export interface ImportPreview {
  kind: ImportKind;
  fileName: string | null;
  rows: ValidatedRow[];
  holdings: ResolvedHolding[];
  counts: { rows: number; valid: number; errors: number; warnings: number; newPositions: number; mergedPositions: number; newSecurities: number };
  canCommit: boolean;
  contentHash: string;
}

/** Latest calendar date anywhere on Earth (UTC+14): a purchase "today" in Israel or New York is never in the future. */
export function latestToday(now = new Date()) {
  return new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10);
}

function issue(code: RowIssue["code"], severity: RowIssue["severity"], field: RowIssue["field"], params?: RowIssue["params"]): RowIssue {
  return { code, severity, field, ...(params && { params }) };
}

async function latestKnownPrice(securityId: string): Promise<{ price: number; currency: string } | null> {
  const [q, b] = await Promise.all([
    db.quoteSnapshot.findFirst({ where: { securityId }, orderBy: { sourceTimestamp: "desc" }, select: { price: true, currency: true } }),
    db.priceBar.findFirst({ where: { securityId }, orderBy: { date: "desc" }, select: { close: true, currency: true } }),
  ]);
  if (q) return { price: Number(q.price), currency: q.currency };
  if (b) return { price: Number(b.close), currency: b.currency };
  return null;
}

/** Validate, resolve against the security master and existing positions. Read-only: nothing is saved. */
export async function previewImport(rawRows: RawHoldingRow[], options: { kind: ImportKind; fileName?: string | null; now?: Date }): Promise<ImportPreview> {
  const rows = validateHoldingRows(rawRows, latestToday(options.now));
  const portfolio = await getDefaultPortfolio();
  const merged = mergeDrafts(rows);
  const holdings: ResolvedHolding[] = [];
  for (const h of merged) {
    const issues: RowIssue[] = [];
    let security = await db.security.findFirst({ where: { ticker: h.ticker, exchange: { code: h.exchange } }, include: { exchange: true } });
    if (!security && h.taseSecurityNumber) {
      security = await db.security.findFirst({ where: { taseSecurityNumber: h.taseSecurityNumber, exchange: { code: "TASE" } }, include: { exchange: true } });
    }
    let resolution: ResolvedHolding["resolution"] = "EXISTING";
    if (!security) {
      if (h.market === "IL" || h.securityType === "ETF") {
        resolution = "CREATE_USER_ENTERED";
        issues.push(issue("SECURITY_WILL_BE_CREATED", "WARNING", "ticker", { ticker: h.ticker, exchange: h.exchange }));
      } else {
        issues.push(issue("SECURITY_NOT_FOUND", "ERROR", "ticker", { ticker: h.ticker, exchange: h.exchange }));
      }
    } else {
      const tradingCurrency = security.exchange.currency === "ILA" ? "ILS" : security.exchange.currency;
      if (tradingCurrency !== h.currency) issues.push(issue("CURRENCY_EXCHANGE_MISMATCH", "ERROR", "currency", { currency: h.currency, exchange: h.exchange, expected: tradingCurrency }));
      if (security.assetType !== h.securityType) issues.push(issue("SECURITY_TYPE_DIFFERS", "WARNING", "securityType", { stored: security.assetType, declared: h.securityType }));
      const known = await latestKnownPrice(security.id);
      if (known && known.currency === h.currency && known.price > 0) {
        const ratio = h.averagePrice / known.price;
        // Off by ~100× is the classic agorot / shekel mix-up; flag anything beyond 30× either way.
        if (ratio > 30 || ratio < 1 / 30) issues.push(issue("PRICE_UNIT_SUSPECT", "WARNING", "averagePrice", { entered: h.averagePrice, latest: known.price, currency: h.currency }));
      }
    }
    const existing = security
      ? await db.position.findUnique({ where: { portfolioId_securityId: { portfolioId: portfolio.id, securityId: security.id } } })
      : null;
    let after = { quantity: h.quantity, averageCost: h.averagePrice };
    if (existing) {
      if (existing.currency !== h.currency) issues.push(issue("CURRENCY_EXCHANGE_MISMATCH", "ERROR", "currency", { currency: h.currency, exchange: h.exchange, expected: existing.currency }));
      const q0 = Number(existing.quantity);
      const q = q0 + h.quantity;
      after = { quantity: q, averageCost: (q0 * Number(existing.averageCost) + h.quantity * h.averagePrice) / q };
      issues.push(issue("MERGES_INTO_EXISTING", "WARNING", "quantity", { quantity: q, averageCost: Math.round(after.averageCost * 1e6) / 1e6 }));
    }
    holdings.push({
      ...h,
      securityId: security?.id ?? null,
      securityName: security?.name ?? h.name,
      resolution,
      existingPosition: existing ? { quantity: Number(existing.quantity), averageCost: Number(existing.averageCost), currency: existing.currency } : null,
      after,
      issues,
    });
  }
  // Attach holding-level issues to their source rows, so the preview shows them where the user looks.
  for (const h of holdings) for (const r of rows) if (h.lines.includes(r.line)) r.issues.push(...h.issues);

  const errors = rows.filter(hasErrors).length;
  const canCommit = rows.length > 0 && errors === 0 && holdings.length > 0;
  const contentHash = createHash("sha256").update(stableStringify(rawRows.map((r) => r.fields))).digest("hex");
  return {
    kind: options.kind,
    fileName: options.fileName ?? null,
    rows,
    holdings,
    counts: {
      rows: rows.length,
      valid: rows.length - errors,
      errors,
      warnings: rows.filter((r) => r.issues.some((i) => i.severity === "WARNING")).length,
      newPositions: holdings.filter((h) => !h.existingPosition).length,
      mergedPositions: holdings.filter((h) => h.existingPosition).length,
      newSecurities: holdings.filter((h) => h.resolution === "CREATE_USER_ENTERED").length,
    },
    canCommit,
    contentHash,
  };
}

export class ImportError extends Error {
  constructor(public readonly code: "PREVIEW_OUTDATED" | "HAS_ERRORS" | "EMPTY") {
    super(code);
  }
}

async function userEnteredSource() {
  return db.dataSource.upsert({
    where: { key: USER_ENTERED_SOURCE_KEY },
    create: { key: USER_ENTERED_SOURCE_KEY, name: "Entered by the user", kind: "MANUAL", description: "Security records created from the user's own holdings import; symbol mapping not verified against an exchange master." },
    update: {},
  });
}

/**
 * Save a previewed import. The rows are validated again and must produce the
 * same content hash as the preview the user confirmed.
 */
export async function commitImport(rawRows: RawHoldingRow[], options: { kind: ImportKind; fileName?: string | null; expectedHash: string; now?: Date }) {
  const preview = await previewImport(rawRows, options);
  if (preview.contentHash !== options.expectedHash) throw new ImportError("PREVIEW_OUTDATED");
  if (!preview.holdings.length) throw new ImportError("EMPTY");
  if (!preview.canCommit) throw new ImportError("HAS_ERRORS");
  const portfolio = await getDefaultPortfolio();
  const source = preview.holdings.some((h) => h.resolution === "CREATE_USER_ENTERED") ? await userEnteredSource() : null;
  const exchanges = new Map((await db.exchange.findMany()).map((e) => [e.code, e]));
  const today = latestToday(options.now);

  const result = await db.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: { kind: options.kind, fileName: options.fileName ?? null, contentHash: preview.contentHash, rowCount: preview.counts.rows, summary: preview.counts as unknown as Prisma.InputJsonValue },
    });
    const securityIds: string[] = [];
    for (const h of preview.holdings) {
      let securityId = h.securityId;
      if (!securityId) {
        const ex = exchanges.get(h.exchange);
        if (!ex) throw new Error(`Exchange ${h.exchange} is not set up; run data:sync-universe once.`);
        const created = await tx.security.create({
          data: {
            ticker: h.ticker,
            exchangeId: ex.id,
            name: h.name ?? h.ticker,
            assetType: h.securityType as AssetType,
            taseSecurityNumber: h.taseSecurityNumber,
            reportingCurrency: h.currency,
            sourceId: source!.id,
          },
        });
        securityId = created.id;
      } else if (h.issues.some((i) => i.code === "SECURITY_TYPE_DIFFERS")) {
        // The user's declared type wins (e.g. an ETF listed as a company in the SEC ticker file).
        await tx.security.update({ where: { id: securityId }, data: { assetType: h.securityType as AssetType } });
      }
      securityIds.push(securityId);
      await upsertHolding(tx, portfolio.id, securityId, h, batch.id);
      await tx.portfolioTransaction.create({
        data: {
          portfolioId: portfolio.id,
          securityId,
          type: "BUY",
          tradeDate: new Date((h.purchaseDate ?? today) + "T00:00:00Z"),
          tradeDateKnown: h.purchaseDate !== null && h.purchaseDate !== undefined,
          quantity: h.quantity,
          price: h.averagePrice,
          currency: h.currency,
          notes: h.notes,
          importBatchId: batch.id,
        },
      });
    }
    return { batchId: batch.id, securityIds };
  });
  for (const id of result.securityIds) await ensureDefaultAlerts(id);
  return { batchId: result.batchId, positions: preview.holdings.length, counts: preview.counts };
}

async function upsertHolding(tx: Prisma.TransactionClient, portfolioId: string, securityId: string, h: HoldingDraft, batchId: string) {
  const existing = await tx.position.findUnique({ where: { portfolioId_securityId: { portfolioId, securityId } } });
  const purchased = h.purchaseDate ? new Date(h.purchaseDate + "T00:00:00Z") : null;
  if (existing) {
    const q0 = Number(existing.quantity);
    const q = q0 + h.quantity;
    await tx.position.update({
      where: { id: existing.id },
      data: {
        quantity: q,
        averageCost: (q0 * Number(existing.averageCost) + h.quantity * h.averagePrice) / q,
        securityType: h.securityType as AssetType,
        costInputUnit: existing.costInputUnit === h.priceUnit ? h.priceUnit : existing.costInputUnit ? "MIXED" : h.priceUnit,
        openedAt: existing.openedAt && purchased ? (existing.openedAt < purchased ? existing.openedAt : purchased) : (existing.openedAt ?? purchased),
        notes: [existing.notes, h.notes].filter(Boolean).join(" · ") || null,
        ...(h.thesisStrategy ? { thesisStrategy: h.thesisStrategy } : {}),
        importBatchId: batchId,
      },
    });
  } else {
    await tx.position.create({
      data: {
        portfolioId,
        securityId,
        quantity: h.quantity,
        averageCost: h.averagePrice,
        currency: h.currency,
        openedAt: purchased,
        notes: h.notes,
        thesisStrategy: h.thesisStrategy,
        securityType: h.securityType as AssetType,
        costInputUnit: h.priceUnit,
        importBatchId: batchId,
      },
    });
  }
}
