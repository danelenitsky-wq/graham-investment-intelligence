import "server-only";
import { env } from "@/server/env";
import { httpGet, parseJson } from "../http";
import { ProviderError, type ProviderDescriptor, type QuoteProvider } from "../types";
import { finnhubQuoteSchema, parseFinnhubQuote } from "./parse";

/**
 * Finnhub free plan — latest US quote only (GET /api/v1/quote, 60 calls/min).
 * Candles, fundamentals and dividends are premium on Finnhub and are not used.
 */
export const FINNHUB: ProviderDescriptor = {
  key: "finnhub",
  name: "Finnhub (free plan quotes)",
  capabilities: ["QUOTES"],
  markets: ["US"],
  baseUrl: "https://finnhub.io/api/v1",
  termsUrl: "https://finnhub.io/terms-of-service",
  requiredEnv: ["FINNHUB_API_KEY"],
  isDevFixture: false,
};

/** Finnhub uses "." for share classes (BRK.B). */
export function finnhubSymbol(ticker: string) {
  return ticker.replace(/-/g, ".").toUpperCase();
}

export const finnhubQuotes: QuoteProvider = {
  descriptor: FINNHUB,
  feed: () => "UNKNOWN",
  // 60 s polling = 1 call/min per open page, well inside 60/min.
  supportsAutoRefresh: () => true,
  async getQuote(security) {
    const key = env().FINNHUB_API_KEY;
    if (!key) throw new ProviderError(FINNHUB.key, "NOT_CONFIGURED", "FINNHUB_API_KEY is not set.");
    const symbol = finnhubSymbol(security.ticker);
    // The token travels in a header so it never appears in URLs or logs.
    const res = await httpGet(FINNHUB.key, `${FINNHUB.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`, {
      headers: { "X-Finnhub-Token": key, Accept: "application/json" },
    });
    const parsed = finnhubQuoteSchema.safeParse(parseJson(FINNHUB.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(FINNHUB.key, "PARSE_ERROR", "Unexpected quote response", res.status, res.endpoint);
    const quote = parseFinnhubQuote(symbol, parsed.data);
    if (!quote) throw new ProviderError(FINNHUB.key, "NOT_FOUND", `No quote for ${symbol}`, res.status, res.endpoint);
    return { quote, meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() } };
  },
};
