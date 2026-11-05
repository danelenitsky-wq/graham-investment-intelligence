/** Pure parser for Twelve Data /quote (https://twelvedata.com/docs#quote). */
import { z } from "zod";
import type { NormalizedQuote } from "../types";

/** Twelve Data sends numbers as strings. */
const numStr = z.union([z.string(), z.number()]).nullable().optional();
const toNum = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const twelveDataQuoteSchema = z.looseObject({
  symbol: z.string().optional(),
  exchange: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  datetime: z.string().nullable().optional(),
  timestamp: z.number().nullable().optional(), // unix seconds of the bar
  last_quote_at: z.number().nullable().optional(), // unix seconds of the last quote
  open: numStr,
  high: numStr,
  low: numStr,
  close: numStr,
  volume: numStr,
  previous_close: numStr,
  change: numStr,
  percent_change: numStr,
  is_market_open: z.boolean().nullable().optional(),
  fifty_two_week: z.looseObject({ low: numStr, high: numStr }).nullable().optional(),
  // error envelope (sent with HTTP 200)
  status: z.string().optional(),
  code: z.number().optional(),
  message: z.string().optional(),
});

export type TwelveDataQuote = z.infer<typeof twelveDataQuoteSchema>;

export function twelveDataError(r: TwelveDataQuote): { code: number | null; message: string } | null {
  return r.status === "error" ? { code: r.code ?? null, message: (r.message ?? "error").slice(0, 200) } : null;
}

/**
 * The free (Basic) plan does not document real-time delivery for every US
 * symbol, so the feed is UNKNOWN (Delayed at best). The 52-week range comes
 * straight from the provider and is labelled as such.
 */
export function parseTwelveDataQuote(symbol: string, r: TwelveDataQuote): NormalizedQuote | null {
  const price = toNum(r.close);
  const ts = r.last_quote_at ?? r.timestamp ?? null;
  if (price === null || !(price > 0) || ts === null || !(ts > 0)) return null;
  const prev = toNum(r.previous_close);
  const pct = toNum(r.percent_change);
  return {
    symbol: (r.symbol ?? symbol).toUpperCase(),
    price,
    previousClose: prev,
    change: toNum(r.change) ?? (prev ? price - prev : null),
    changePercent: pct !== null ? pct / 100 : prev ? price / prev - 1 : null,
    open: toNum(r.open),
    dayHigh: toNum(r.high),
    dayLow: toNum(r.low),
    volume: toNum(r.volume),
    marketCap: null,
    yearHigh: toNum(r.fifty_two_week?.high),
    yearLow: toNum(r.fifty_two_week?.low),
    currency: r.currency ?? "USD",
    exchange: r.exchange ?? null,
    sourceTimestamp: new Date(ts * 1000).toISOString(),
    feed: "UNKNOWN",
    delayMinutes: null,
    feedNote: "TWELVE_DATA_FREE",
  };
}
