import "server-only";
import { BOI, fetchBoiRates } from "@/lib/providers/boi";
import { ProviderError } from "@/lib/providers/types";
import { DEFAULT_FX_POLICY, type FxRateRecord } from "@/lib/portfolio/fx";
import type { HoldingInput } from "@/lib/portfolio";
import { isCurrency } from "@/lib/portfolio/currency";
import { db } from "./db";
import { ensureSource, failFetch, finishFetch, startFetch } from "./ingestion";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Stored FX observations (most recent first) as engine records. */
export async function listFxRates(take = 60): Promise<(FxRateRecord & { id: string; retrievedAt: string; sourceKey: string })[]> {
  const rows = await db.fxRate.findMany({ orderBy: [{ rateDate: "desc" }, { retrievedAt: "desc" }], take });
  return rows
    .filter((r) => isCurrency(r.base) && isCurrency(r.quote))
    .map((r) => ({
      id: r.id,
      base: r.base as FxRateRecord["base"],
      quote: r.quote as FxRateRecord["quote"],
      rate: Number(r.rate),
      date: iso(r.rateDate),
      kind: r.kind,
      sourceLabel: r.sourceLabel,
      sourceKey: r.sourceKey,
      retrievedAt: r.retrievedAt.toISOString(),
    }));
}

/** Dates (YYYY-MM-DD) on which foreign-currency holdings were bought: their cost is converted at those dates' rates. */
export function purchaseDates(holdings: Pick<HoldingInput, "currency" | "trades" | "openedAt">[], base: string): string[] {
  const dates = new Set<string>();
  for (const h of holdings) {
    if (h.currency === base) continue;
    for (const t of h.trades ?? []) if (t.type === "BUY" && t.date) dates.add(t.date);
    if (h.openedAt) dates.add(h.openedAt);
  }
  return [...dates].sort();
}

/**
 * Recent rates plus every stored rate in the look-back window before each
 * purchase date of a foreign-currency holding (for the historical cost basis).
 */
export async function listFxRatesForPortfolio(holdings: Pick<HoldingInput, "currency" | "trades" | "openedAt">[], base: string) {
  const recent = await listFxRates();
  const dates = purchaseDates(holdings, base);
  if (!dates.length) return recent;
  const window = DEFAULT_FX_POLICY.maxAgeDays * 86_400_000;
  const rows = await db.fxRate.findMany({
    where: { OR: dates.map((d) => ({ rateDate: { gte: new Date(Date.parse(d + "T00:00:00Z") - window), lte: new Date(d + "T00:00:00Z") } })) },
  });
  const seen = new Set(recent.map((r) => r.id));
  const extra = rows
    .filter((r) => !seen.has(r.id) && isCurrency(r.base) && isCurrency(r.quote))
    .map((r) => ({ id: r.id, base: r.base as FxRateRecord["base"], quote: r.quote as FxRateRecord["quote"], rate: Number(r.rate), date: iso(r.rateDate), kind: r.kind, sourceLabel: r.sourceLabel, sourceKey: r.sourceKey, retrievedAt: r.retrievedAt.toISOString() }));
  return [...recent, ...extra];
}

/**
 * Fetch Bank of Israel rates for purchase dates that have no usable stored
 * rate yet (one request per missing date, covering the 7 days before it).
 */
export async function backfillPurchaseDateRates(dates: string[]): Promise<{ requested: number; stored: number; failed: { date: string; error: string }[] }> {
  const failed: { date: string; error: string }[] = [];
  let stored = 0;
  let requested = 0;
  const window = DEFAULT_FX_POLICY.maxAgeDays * 86_400_000;
  for (const d of dates) {
    const from = new Date(Date.parse(d + "T00:00:00Z") - window);
    const have = await db.fxRate.count({ where: { base: "USD", quote: "ILS", kind: "OFFICIAL", rateDate: { gte: from, lte: new Date(d + "T00:00:00Z") } } });
    if (have > 0) continue;
    requested++;
    const r = await refreshBoiRates({ start: iso(from), end: d });
    if (r.status === "SUCCESS") stored += r.stored;
    else failed.push({ date: d, error: r.error ?? "unknown" });
  }
  return { requested, stored, failed };
}

/**
 * Fetch the Bank of Israel USD/ILS representative rate for the last `days`
 * calendar days and store each published observation. Days without a
 * publication (weekends, holidays) get no row.
 */
export async function refreshBoiRates(range: number | { start: string; end: string } = 14): Promise<{ status: "SUCCESS" | "FAILED"; stored: number; latest: string | null; error?: string }> {
  const source = await ensureSource(BOI);
  const end = typeof range === "number" ? iso(new Date()) : range.end;
  const start = typeof range === "number" ? iso(new Date(Date.now() - range * 86_400_000)) : range.start;
  const fetch = await startFetch(source.id, "fx-rates", BOI.baseUrl);
  try {
    const { rates, meta } = await fetchBoiRates("USD", "ILS", { start, end });
    for (const r of rates) {
      await db.fxRate.upsert({
        where: { base_quote_rateDate_sourceKey: { base: r.base, quote: r.quote, rateDate: new Date(r.date + "T00:00:00Z"), sourceKey: BOI.key } },
        create: { base: r.base, quote: r.quote, rate: r.rate, rateDate: new Date(r.date + "T00:00:00Z"), kind: "OFFICIAL", sourceKey: BOI.key, sourceLabel: `Bank of Israel representative rate (${r.series})`, fetchId: fetch.id },
        update: { rate: r.rate, fetchId: fetch.id, retrievedAt: new Date() },
      });
    }
    await finishFetch(fetch.id, { status: "SUCCESS", endpoint: meta.endpoint, httpStatus: meta.httpStatus, payloadHash: meta.payloadHash, recordCount: rates.length });
    return { status: "SUCCESS", stored: rates.length, latest: rates.at(-1)?.date ?? null };
  } catch (e) {
    await failFetch(fetch.id, e);
    return { status: "FAILED", stored: 0, latest: null, error: e instanceof ProviderError ? `${e.code}: ${e.message}` : String(e) };
  }
}

/** A rate the user typed in, with its date and source. Labelled MANUAL everywhere it is used. */
export async function addManualFxRate(input: { base: "USD" | "ILS"; quote: "USD" | "ILS"; rate: number; date: string; sourceLabel: string }) {
  return db.fxRate.upsert({
    where: { base_quote_rateDate_sourceKey: { base: input.base, quote: input.quote, rateDate: new Date(input.date + "T00:00:00Z"), sourceKey: "manual" } },
    create: { base: input.base, quote: input.quote, rate: input.rate, rateDate: new Date(input.date + "T00:00:00Z"), kind: "MANUAL", sourceKey: "manual", sourceLabel: input.sourceLabel },
    update: { rate: input.rate, sourceLabel: input.sourceLabel, retrievedAt: new Date() },
  });
}

export async function deleteFxRate(id: string) {
  await db.fxRate.delete({ where: { id } });
}
