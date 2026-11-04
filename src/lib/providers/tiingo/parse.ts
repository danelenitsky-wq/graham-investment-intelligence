/** Pure parser for Tiingo end-of-day prices (https://www.tiingo.com/documentation/end-of-day). */
import { z } from "zod";
import type { NormalizedQuote } from "../types";
import { makeBar, toIsoDate, validatePriceBars, type NormalizedDividend, type NormalizedPriceBar, type NormalizedSplit } from "@/lib/normalization/market";

export const tiingoRowSchema = z.object({
  date: z.string(),
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  close: z.number(),
  volume: z.number().nullable().optional(),
  adjClose: z.number().nullable().optional(),
  divCash: z.number().nullable().optional(),
  splitFactor: z.number().nullable().optional(),
});
export const tiingoResponseSchema = z.array(tiingoRowSchema);

export function parseTiingoPrices(rows: z.infer<typeof tiingoResponseSchema>, currency = "USD") {
  const bars: NormalizedPriceBar[] = [];
  const dividends: NormalizedDividend[] = [];
  const splits: NormalizedSplit[] = [];
  for (const r of rows) {
    const bar = makeBar({ ...r, currency });
    if (bar) bars.push(bar);
    const date = toIsoDate(r.date);
    if (!date) continue;
    if (r.divCash && r.divCash > 0) dividends.push({ exDate: date, amount: r.divCash, currency });
    if (r.splitFactor && r.splitFactor !== 1) splits.push({ exDate: date, ratio: r.splitFactor });
  }
  const validated = validatePriceBars(bars);
  return { bars: validated.bars, rejected: validated.rejected, dividends, splits };
}

/** Tiingo IEX top-of-book / last sale (https://www.tiingo.com/documentation/iex). */
export const tiingoIexSchema = z.array(
  z.looseObject({
    ticker: z.string(),
    timestamp: z.string().nullable().optional(),
    lastSaleTimestamp: z.string().nullable().optional(),
    quoteTimestamp: z.string().nullable().optional(),
    last: z.number().nullable().optional(),
    tngoLast: z.number().nullable().optional(),
    prevClose: z.number().nullable().optional(),
    open: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    low: z.number().nullable().optional(),
    volume: z.number().nullable().optional(),
  }),
);

/**
 * Uses only `last` (an actual IEX trade) with `lastSaleTimestamp`. `tngoLast`
 * is a Tiingo-derived estimate and is deliberately not used as a price.
 */
export function parseTiingoIex(rows: z.infer<typeof tiingoIexSchema>): NormalizedQuote | null {
  const r = rows[0];
  if (!r || r.last == null || !(r.last > 0) || !r.lastSaleTimestamp) return null;
  const ts = Date.parse(r.lastSaleTimestamp);
  if (!Number.isFinite(ts)) return null;
  const prev = r.prevClose ?? null;
  return {
    symbol: r.ticker.toUpperCase(),
    price: r.last,
    previousClose: prev,
    change: prev ? r.last - prev : null,
    changePercent: prev ? r.last / prev - 1 : null,
    open: r.open ?? null,
    dayHigh: r.high ?? null,
    dayLow: r.low ?? null,
    volume: r.volume ?? null,
    marketCap: null,
    yearHigh: null,
    yearLow: null,
    currency: "USD",
    exchange: "IEX",
    sourceTimestamp: new Date(ts).toISOString(),
    feed: "REALTIME",
    delayMinutes: null,
    feedNote: "IEX_ONLY",
  };
}
