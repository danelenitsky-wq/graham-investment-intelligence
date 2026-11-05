import "server-only";
import { env } from "@/server/env";
import { httpGet, parseJson } from "../http";
import { ProviderError, type PriceProvider, type ProviderDescriptor, type QuoteProvider } from "../types";
import { parseTiingoEodQuote, parseTiingoIex, parseTiingoPrices, tiingoIexSchema, tiingoResponseSchema } from "./parse";

export const TIINGO: ProviderDescriptor = {
  key: "tiingo",
  name: "Tiingo (end-of-day prices, IEX quotes)",
  capabilities: ["PRICES", "QUOTES", "VERIFICATION"],
  markets: ["US"],
  baseUrl: "https://api.tiingo.com",
  termsUrl: "https://www.tiingo.com/about/terms",
  requiredEnv: ["TIINGO_API_KEY"],
  isDevFixture: false,
};

/** Tiingo uses "-" for share classes (BRK-B) where SEC uses "-" or ".". */
export function tiingoTicker(ticker: string) {
  return ticker.replace(/\./g, "-").toLowerCase();
}

export const tiingoPrices: PriceProvider = {
  descriptor: TIINGO,
  async getDailyHistory(security, range) {
    const key = env().TIINGO_API_KEY;
    if (!key) throw new ProviderError(TIINGO.key, "NOT_CONFIGURED", "TIINGO_API_KEY is not set.");
    const url =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(tiingoTicker(security.ticker))}/prices` +
      `?startDate=${range.start}&endDate=${range.end}&format=json`;
    // The key travels in a header so it never appears in URLs or logs.
    const res = await httpGet(TIINGO.key, url, { headers: { Authorization: `Token ${key}`, Accept: "application/json" } });
    const parsed = tiingoResponseSchema.safeParse(parseJson(TIINGO.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(TIINGO.key, "PARSE_ERROR", "Unexpected price response", res.status, res.endpoint);
    return {
      ...parseTiingoPrices(parsed.data, "USD"),
      meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() },
    };
  },
};

/**
 * Tiingo IEX last sale. Real-time, but only trades executed on IEX (~2-3% of
 * US volume), so the UI always shows "IEX only" next to it. The free plan
 * allows 50 requests/hour, too few for 60 s polling; set TIINGO_PLAN=power (or
 * commercial) to enable automatic refresh with this provider.
 */
export const tiingoQuotes: QuoteProvider = {
  descriptor: TIINGO,
  feed: () => "REALTIME",
  supportsAutoRefresh: () => ["power", "commercial"].includes(env().TIINGO_PLAN ?? "free"),
  async getQuote(security) {
    const key = env().TIINGO_API_KEY;
    if (!key) throw new ProviderError(TIINGO.key, "NOT_CONFIGURED", "TIINGO_API_KEY is not set.");
    const url = `https://api.tiingo.com/iex/?tickers=${encodeURIComponent(tiingoTicker(security.ticker))}`;
    const res = await httpGet(TIINGO.key, url, { headers: { Authorization: `Token ${key}`, Accept: "application/json" } });
    const parsed = tiingoIexSchema.safeParse(parseJson(TIINGO.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(TIINGO.key, "PARSE_ERROR", "Unexpected IEX response", res.status, res.endpoint);
    const quote = parseTiingoIex(parsed.data);
    if (quote) return { quote, meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() } };

    // No IEX last sale (null `last` on plans without IEX trade data). tngoLast
    // is a derived mid, not a trade, so fall back to the official latest close.
    const start = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const eodUrl = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(tiingoTicker(security.ticker))}/prices?startDate=${start}&format=json`;
    const eodRes = await httpGet(TIINGO.key, eodUrl, { headers: { Authorization: `Token ${key}`, Accept: "application/json" } });
    const eod = tiingoResponseSchema.safeParse(parseJson(TIINGO.key, eodRes.text, eodRes.endpoint));
    if (!eod.success) throw new ProviderError(TIINGO.key, "PARSE_ERROR", "Unexpected price response", eodRes.status, eodRes.endpoint);
    const eodQuote = parseTiingoEodQuote(security.ticker, eod.data);
    if (!eodQuote) throw new ProviderError(TIINGO.key, "NOT_FOUND", `No IEX last sale or end-of-day close for ${security.ticker}`, eodRes.status, eodRes.endpoint);
    return { quote: eodQuote, meta: { endpoint: eodRes.endpoint, httpStatus: eodRes.status, payloadHash: eodRes.payloadHash, fetchedAt: new Date().toISOString() } };
  },
};
