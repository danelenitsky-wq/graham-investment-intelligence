"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { loadDevFixtures, refreshSecurity, syncUniverse, type RefreshOutcome } from "@/server/ingestion";
import { getDefaultPortfolio } from "@/server/portfolio";
import { getSettings, saveSettings } from "@/server/settings";
import { getDefaultWatchlist } from "@/server/watchlist";
import { saveDecisionSnapshot } from "@/server/decision";
import { settingsSchema } from "@/lib/settings/schema";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; code?: string };

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export async function refreshSecurityAction(securityId: string): Promise<ActionResult<RefreshOutcome>> {
  try {
    const data = await refreshSecurity(z.string().min(1).parse(securityId));
    refresh();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function syncUniverseAction(): Promise<ActionResult<{ upserted: number }>> {
  try {
    const data = await syncUniverse();
    refresh();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: errorMessage(e), code: (e as { code?: string }).code };
  }
}

export async function loadFixturesAction(): Promise<ActionResult<{ securities: number }>> {
  try {
    const data = await loadDevFixtures();
    refresh();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function toggleWatchlistAction(securityId: string): Promise<ActionResult<{ onWatchlist: boolean }>> {
  try {
    const wl = await getDefaultWatchlist();
    const key = { watchlistId_securityId: { watchlistId: wl.id, securityId } };
    const existing = await db.watchlistItem.findUnique({ where: key });
    if (existing) await db.watchlistItem.delete({ where: key });
    else await db.watchlistItem.create({ data: { watchlistId: wl.id, securityId } });
    refresh();
    return { ok: true, data: { onWatchlist: !existing } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

const positionSchema = z.object({
  ticker: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
  exchange: z.string().trim().min(1).max(16).transform((s) => s.toUpperCase()),
  quantity: z.coerce.number().positive(),
  averageCost: z.coerce.number().positive(),
  thesisStrategy: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(["DEFENSIVE", "ENTERPRISING", "NET_NET"]).nullable()).optional(),
});

export async function addPositionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = positionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "invalid", code: "INVALID" };
  const { ticker, exchange, quantity, averageCost } = parsed.data;
  const thesisStrategy = parsed.data.thesisStrategy ?? null;
  const security = await db.security.findFirst({ where: { ticker, exchange: { code: exchange } }, include: { exchange: true } });
  if (!security) return { ok: false, error: "notFound", code: "NOT_FOUND" };
  const portfolio = await getDefaultPortfolio();
  const currency = security.exchange.currency;
  await db.$transaction(async (tx) => {
    const existing = await tx.position.findUnique({ where: { portfolioId_securityId: { portfolioId: portfolio.id, securityId: security.id } } });
    if (existing) {
      const q0 = Number(existing.quantity);
      const total = q0 + quantity;
      await tx.position.update({
        where: { id: existing.id },
        data: { quantity: total, averageCost: (q0 * Number(existing.averageCost) + quantity * averageCost) / total, ...(thesisStrategy ? { thesisStrategy } : {}) },
      });
    } else {
      await tx.position.create({ data: { portfolioId: portfolio.id, securityId: security.id, quantity, averageCost, currency, openedAt: new Date(), thesisStrategy } });
    }
    await tx.portfolioTransaction.create({
      data: { portfolioId: portfolio.id, securityId: security.id, type: "BUY", tradeDate: new Date(), quantity, price: averageCost, currency },
    });
  });
  refresh();
  return { ok: true };
}

export async function removePositionAction(positionId: string): Promise<ActionResult> {
  await db.position.delete({ where: { id: z.string().min(1).parse(positionId) } });
  refresh();
  return { ok: true };
}

const optionalManual = (prefix: string, fd: FormData) => {
  const value = String(fd.get(`${prefix}Value`) ?? "").trim();
  if (!value) return null;
  return { value: Number(value), asOf: String(fd.get(`${prefix}AsOf`) ?? ""), source: String(fd.get(`${prefix}Source`) ?? "").trim() };
};

export async function saveSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const current = await getSettings();
  const candidate = {
    ...current,
    aaaBondYield: optionalManual("aaa", formData),
    currentCpi: optionalManual("cpi", formData),
    freshness: {
      priceAgingDays: Number(formData.get("priceAgingDays")),
      priceStaleDays: Number(formData.get("priceStaleDays")),
      fundamentalsAgingMonths: Number(formData.get("fundamentalsAgingMonths")),
      fundamentalsStaleMonths: Number(formData.get("fundamentalsStaleMonths")),
    },
    enterprisingLookbackYears: Number(formData.get("enterprisingLookbackYears")),
    priceHistoryYears: Number(formData.get("priceHistoryYears")),
    valuation: {
      marginOfSafetyTarget: Number(formData.get("marginOfSafetyTarget")) / 100,
      intrinsicEnabled: formData.get("intrinsicEnabled") === "on",
      discountRate: Number(formData.get("discountRate")) / 100,
      terminalGrowth: Number(formData.get("terminalGrowth")) / 100,
      normalizationYears: Number(formData.get("normalizationYears")),
    },
    decision: {
      strategy: String(formData.get("decisionStrategy") ?? current.decision.strategy),
      maxPositionWeight: Number(formData.get("maxPositionWeight")) / 100,
      excessiveValuationMultiple: Number(formData.get("excessiveValuationMultiple")),
      requireIntrinsicMarginOfSafety: formData.get("requireIntrinsicMarginOfSafety") === "on",
    },
  };
  const parsed = settingsSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.path.join(".")).join(", "), code: "INVALID" };
  await saveSettings(parsed.data);
  refresh();
  return { ok: true };
}

const strategySchema = z.enum(["DEFENSIVE", "ENTERPRISING", "NET_NET"]).nullable();

/** Save a timestamped decision snapshot (inputs, sources, versions, assumptions, assessment). */
export async function saveDecisionSnapshotAction(securityId: string, strategy: string | null): Promise<ActionResult<{ saved: boolean; id: string | null }>> {
  try {
    const data = await saveDecisionSnapshot(z.string().min(1).parse(securityId), { trigger: "MANUAL", strategy: strategySchema.parse(strategy) });
    refresh();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
