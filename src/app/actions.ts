"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { loadDevFixtures, refreshSecurity, syncUniverse, type RefreshOutcome } from "@/server/ingestion";
import { backfillPortfolioFxRates, getDefaultPortfolio, setBaseCurrency, updatePosition } from "@/server/portfolio";
import { commitImport, ImportError, previewImport, type ImportPreview } from "@/server/portfolio-import";
import { extractCsv } from "@/lib/portfolio/import/sources";
import type { RawHoldingRow } from "@/lib/portfolio/import/validate";
import { hasErrors } from "@/lib/portfolio/import/validate";
import { parsePriceUnit } from "@/lib/portfolio/currency";
import { zonedTimeToUtc } from "@/lib/market/calendar";
import { ManualPriceError, recordManualPrice } from "@/server/manual-prices";
import { addManualFxRate, deleteFxRate, refreshBoiRates } from "@/server/fx";
import { addToWatchlist, updateWatchlistItem } from "@/server/watchlist";
import { ensureDefaultAlerts, runAlertChecks, type AlertRunSummary } from "@/server/alerts";
import { getQuoteView } from "@/server/quotes";
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
    else {
      await db.watchlistItem.create({ data: { watchlistId: wl.id, securityId } });
      await ensureDefaultAlerts(securityId);
    }
    refresh();
    return { ok: true, data: { onWatchlist: !existing } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
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

// ───────────────────────────── Holdings import ─────────────────────────────

const importTextSchema = z.string().min(1).max(1_000_000);
const fileNameSchema = z.string().max(200).nullable();

export type ImportPreviewResult = ActionResult<{ preview: ImportPreview; sourceErrors: { code: string; message: string; line?: number }[]; unmappedColumns: string[]; missingColumns: string[] }>;

/** Validate a CSV and return the preview. Nothing is saved. */
export async function previewCsvImportAction(text: string, fileName: string | null): Promise<ImportPreviewResult> {
  try {
    const x = extractCsv(importTextSchema.parse(text));
    const preview = await previewImport(x.rows, { kind: "CSV", fileName: fileNameSchema.parse(fileName) });
    const blocked = x.errors.length > 0 || x.missingColumns.length > 0;
    return { ok: true, data: { preview: { ...preview, canCommit: preview.canCommit && !blocked }, sourceErrors: x.errors, unmappedColumns: x.unmappedColumns, missingColumns: x.missingColumns } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Save a CSV import the user confirmed. The file must still produce the confirmed preview. */
export async function commitCsvImportAction(text: string, fileName: string | null, expectedHash: string): Promise<ActionResult<{ positions: number }>> {
  try {
    const x = extractCsv(importTextSchema.parse(text));
    if (x.errors.length || x.missingColumns.length) return { ok: false, error: "invalid", code: "HAS_ERRORS" };
    const r = await commitImport(x.rows, { kind: "CSV", fileName: fileNameSchema.parse(fileName), expectedHash: z.string().min(16).parse(expectedHash) });
    refresh();
    return { ok: true, data: { positions: r.positions } };
  } catch (e) {
    return { ok: false, error: errorMessage(e), code: e instanceof ImportError ? e.code : undefined };
  }
}

export type HoldingFormResult = ActionResult<{ preview: ImportPreview }> & { preview?: ImportPreview };

/**
 * Manual entry of one holding. Same validation as CSV imports; warnings
 * (new user-entered security, merge into an existing position, suspicious
 * price unit…) must be confirmed before anything is saved.
 */
export async function addHoldingAction(_prev: HoldingFormResult | null, formData: FormData): Promise<HoldingFormResult> {
  const get = (k: string) => String(formData.get(k) ?? "");
  const row: RawHoldingRow = {
    line: 1,
    fields: {
      ticker: get("ticker"),
      exchange: get("exchange"),
      securityType: get("securityType"),
      quantity: get("quantity"),
      averagePrice: get("averagePrice"),
      currency: get("currency"),
      priceUnit: get("priceUnit"),
      purchaseDate: get("purchaseDate"),
      notes: get("notes"),
      name: get("name"),
      thesisStrategy: get("thesisStrategy"),
    },
  };
  try {
    const preview = await previewImport([row], { kind: "MANUAL" });
    if (preview.rows.some(hasErrors)) return { ok: false, error: "invalid", code: "INVALID", preview };
    const warnings = preview.rows.some((r) => r.issues.some((i) => i.severity === "WARNING"));
    if (warnings && formData.get("confirmed") !== preview.contentHash) return { ok: false, error: "confirm", code: "NEEDS_CONFIRMATION", preview };
    await commitImport([row], { kind: "MANUAL", expectedHash: preview.contentHash });
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updatePositionAction(positionId: string, notes: string | null, thesisStrategy: string | null): Promise<ActionResult> {
  try {
    await updatePosition(z.string().min(1).parse(positionId), { notes: z.string().max(500).nullable().parse(notes || null), thesisStrategy: strategySchema.parse(thesisStrategy || null) });
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setBaseCurrencyAction(currency: string): Promise<ActionResult> {
  await setBaseCurrency(z.enum(["USD", "ILS"]).parse(currency));
  refresh();
  return { ok: true };
}

/** Refresh quotes for the holdings (cache policy and free-plan budgets apply). */
export async function refreshPortfolioQuotesAction(): Promise<ActionResult<{ providerCalls: number }>> {
  try {
    const portfolio = await getDefaultPortfolio();
    const positions = await db.position.findMany({ where: { portfolioId: portfolio.id }, select: { securityId: true } });
    let calls = 0;
    for (const p of positions) {
      if (calls >= 20) break;
      const q = await getQuoteView(p.securityId);
      calls += q.attempts.length;
    }
    refresh();
    return { ok: true, data: { providerCalls: calls } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ─────────────────────────── Manual prices and FX ───────────────────────────

const manualPriceSchema = z.object({
  securityId: z.string().min(1),
  price: z.coerce.number().positive().max(1e9),
  unit: z.string().transform((v, ctx) => {
    const u = parsePriceUnit(v);
    if (!u) ctx.addIssue({ code: "custom", message: "unit" });
    return u!;
  }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  sourceLabel: z.string().trim().min(2).max(200),
});

/** Record a manual price with the time it refers to (exchange-local) and its source. */
export async function recordManualPriceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = manualPriceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "invalid", code: "INVALID" };
  const d = parsed.data;
  try {
    const sec = await db.security.findUniqueOrThrow({ where: { id: d.securityId }, include: { exchange: true } });
    const timestamp = zonedTimeToUtc(d.date, d.time, sec.exchange.timezone);
    await recordManualPrice({ securityId: d.securityId, price: d.price, unit: d.unit, timestamp, sourceLabel: d.sourceLabel });
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e), code: e instanceof ManualPriceError ? e.code : undefined };
  }
}

export async function refreshFxAction(): Promise<ActionResult<{ stored: number; latest: string | null }>> {
  const r = await refreshBoiRates();
  // Also fetch the rates of purchase dates, for the historical cost basis of foreign-currency holdings.
  if (r.status === "SUCCESS") await backfillPortfolioFxRates().catch(() => null);
  refresh();
  return r.status === "SUCCESS" ? { ok: true, data: { stored: r.stored, latest: r.latest } } : { ok: false, error: r.error ?? "failed" };
}

const manualFxSchema = z.object({
  rate: z.coerce.number().positive().max(1000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceLabel: z.string().trim().min(2).max(200),
});

/** A USD/ILS rate typed in by the user (labelled MANUAL wherever it is used). */
export async function addManualFxAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = manualFxSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "invalid", code: "INVALID" };
  if (parsed.data.date > new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10)) return { ok: false, error: "future", code: "INVALID" };
  await addManualFxRate({ base: "USD", quote: "ILS", ...parsed.data });
  refresh();
  return { ok: true };
}

export async function deleteFxRateAction(id: string): Promise<ActionResult> {
  await deleteFxRate(z.string().min(1).parse(id));
  refresh();
  return { ok: true };
}

// ─────────────────────────────── Watchlist ───────────────────────────────

export async function addWatchlistBySymbolAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ticker = String(formData.get("ticker") ?? "").trim().toUpperCase();
  const exchange = String(formData.get("exchange") ?? "").trim().toUpperCase();
  if (!ticker || !exchange) return { ok: false, error: "invalid", code: "INVALID" };
  const security = await db.security.findFirst({ where: { ticker, exchange: { code: exchange } } });
  if (!security) return { ok: false, error: "notFound", code: "NOT_FOUND" };
  await addToWatchlist(security.id, { notes: String(formData.get("notes") ?? "").trim() || null });
  refresh();
  return { ok: true };
}

const watchlistUpdateSchema = z.object({
  itemId: z.string().min(1),
  targetPrice: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().positive().max(1e9).nullable()),
  marginOfSafetyTarget: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().min(0).max(90).nullable()),
  notes: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(500).nullable()),
});

export async function updateWatchlistItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = watchlistUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "invalid", code: "INVALID" };
  const d = parsed.data;
  await updateWatchlistItem(d.itemId, { targetPrice: d.targetPrice, marginOfSafetyTarget: d.marginOfSafetyTarget === null ? null : d.marginOfSafetyTarget / 100, notes: d.notes });
  refresh();
  return { ok: true };
}

// ──────────────────────────────── Alerts ────────────────────────────────

export async function runAlertChecksAction(fetchData: boolean): Promise<ActionResult<AlertRunSummary>> {
  try {
    const data = await runAlertChecks({ trigger: "MANUAL", fetch: z.boolean().parse(fetchData) });
    refresh();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function acknowledgeAlertAction(id: string | null): Promise<ActionResult> {
  if (id) await db.alertEvent.update({ where: { id }, data: { acknowledgedAt: new Date() } });
  else await db.alertEvent.updateMany({ where: { acknowledgedAt: null }, data: { acknowledgedAt: new Date() } });
  refresh();
  return { ok: true };
}

export async function setAlertRuleStatusAction(id: string, active: boolean): Promise<ActionResult> {
  await db.alert.update({ where: { id: z.string().min(1).parse(id) }, data: { status: active ? "ACTIVE" : "DISABLED" } });
  refresh();
  return { ok: true };
}
