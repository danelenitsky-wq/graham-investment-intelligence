import "server-only";
import { BOI, fetchBoiRates } from "@/lib/providers/boi";
import { ProviderError } from "@/lib/providers/types";
import type { FxRateRecord } from "@/lib/portfolio/fx";
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

/**
 * Fetch the Bank of Israel USD/ILS representative rate for the last `days`
 * calendar days and store each published observation. Days without a
 * publication (weekends, holidays) get no row.
 */
export async function refreshBoiRates(days = 14): Promise<{ status: "SUCCESS" | "FAILED"; stored: number; latest: string | null; error?: string }> {
  const source = await ensureSource(BOI);
  const end = iso(new Date());
  const start = iso(new Date(Date.now() - days * 86_400_000));
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
