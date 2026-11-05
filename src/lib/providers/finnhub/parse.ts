/** Pure parser for Finnhub /quote (https://finnhub.io/docs/api/quote). */
import { z } from "zod";
import type { NormalizedQuote } from "../types";

export const finnhubQuoteSchema = z.looseObject({
  c: z.number().nullable(), // current price
  d: z.number().nullable().optional(),
  dp: z.number().nullable().optional(), // percent
  h: z.number().nullable().optional(),
  l: z.number().nullable().optional(),
  o: z.number().nullable().optional(),
  pc: z.number().nullable().optional(),
  t: z.number().nullable().optional(), // unix seconds
});

/**
 * Finnhub answers unknown symbols with HTTP 200 and all-zero fields, so a
 * zero price or missing timestamp is "not found", never a price of 0.
 * Finnhub does not document whether the free plan's quote is real-time for
 * every symbol, so the feed is UNKNOWN: shown as Delayed at best, never Fresh.
 */
export function parseFinnhubQuote(symbol: string, r: z.infer<typeof finnhubQuoteSchema>): NormalizedQuote | null {
  if (r.c == null || !(r.c > 0) || r.t == null || !(r.t > 0)) return null;
  const prev = r.pc != null && r.pc > 0 ? r.pc : null;
  return {
    symbol: symbol.toUpperCase(),
    price: r.c,
    previousClose: prev,
    change: r.d ?? (prev ? r.c - prev : null),
    changePercent: r.dp != null ? r.dp / 100 : prev ? r.c / prev - 1 : null,
    open: r.o && r.o > 0 ? r.o : null,
    dayHigh: r.h && r.h > 0 ? r.h : null,
    dayLow: r.l && r.l > 0 ? r.l : null,
    volume: null,
    marketCap: null,
    yearHigh: null,
    yearLow: null,
    currency: "USD",
    exchange: null,
    sourceTimestamp: new Date(r.t * 1000).toISOString(),
    feed: "UNKNOWN",
    delayMinutes: null,
    feedNote: "FINNHUB_FREE",
  };
}
