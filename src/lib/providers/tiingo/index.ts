import "server-only";
import { env } from "@/server/env";
import { httpGet, parseJson } from "../http";
import { ProviderError, type PriceProvider, type ProviderDescriptor, type QuoteProvider } from "../types";
import { parseTiingoEodQuote, parseTiingoIex, parseTiingoPrices, tiingoIexSchema, tiingoResponseSchema } from "./parse";

export const TIINGO: ProviderDescriptor = {
  key: "tiingo",
  name: "Tiingo (end-of-day prices, dividends, splits)",
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
    const headers = tiingoAuth();
    const url =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(tiingoTicker(security.ticker))}/prices` +
      `?startDate=${range.start}&endDate=${range.end}&format=json`;
    // The key travels in a header so it never appears in URLs or logs.
    const res = await httpGet(TIINGO.key, url, { headers, budget: tiingoBudget(), timeoutMs: 45_000 });
    const parsed = tiingoResponseSchema.safeParse(parseJson(TIINGO.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(TIINGO.key, "PARSE_ERROR", "Unexpected price response", res.status, res.endpoint);
    return {
      ...parseTiingoPrices(parsed.data, "USD"),
      meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() },
    };
  },
};

const PAID_TIINGO = ["power", "commercial"];

function tiingoAuth() {
  const key = env().TIINGO_API_KEY;
  if (!key) throw new ProviderError(TIINGO.key, "NOT_CONFIGURED", "TIINGO_API_KEY is not set.");
  return { Authorization: `Token ${key}`, Accept: "application/json" };
}

/** Request budget: free plan 50/hour + 1,000/day; paid plans are far higher. */
function tiingoBudget() {
  return PAID_TIINGO.includes(env().TIINGO_PLAN ?? "free") ? { perHour: 9_500 } : undefined;
}

/**
 * Latest quote from Tiingo.
 *
 * Free plan (default): the official end-of-day close of the latest session
 * (GET /tiingo/daily/{t}/prices). Feed EOD, so it can only ever be shown as
 * Last close (or stale). The IEX endpoint is skipped on the free plan: the
 * live test on 2026-11-05 showed it returns no last sale there, so calling it
 * would only spend the 50 requests/hour budget.
 *
 * Paid plans (TIINGO_PLAN=power|commercial): IEX last sale first (real-time but
 * IEX venue only, labelled "IEX only"), then the official close as fallback.
 */
export const tiingoQuotes: QuoteProvider = {
  descriptor: TIINGO,
  feed: () => (PAID_TIINGO.includes(env().TIINGO_PLAN ?? "free") ? "REALTIME" : "EOD"),
  supportsAutoRefresh: () => PAID_TIINGO.includes(env().TIINGO_PLAN ?? "free"),
  async getQuote(security) {
    const headers = tiingoAuth();
    const budget = tiingoBudget();
    const ticker = encodeURIComponent(tiingoTicker(security.ticker));
    if (PAID_TIINGO.includes(env().TIINGO_PLAN ?? "free")) {
      const res = await httpGet(TIINGO.key, `https://api.tiingo.com/iex/?tickers=${ticker}`, { headers, budget });
      const parsed = tiingoIexSchema.safeParse(parseJson(TIINGO.key, res.text, res.endpoint));
      if (!parsed.success) throw new ProviderError(TIINGO.key, "PARSE_ERROR", "Unexpected IEX response", res.status, res.endpoint);
      const quote = parseTiingoIex(parsed.data);
      if (quote) return { quote, meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() } };
    }
    // tngoLast is a derived mid, not a trade, so the fallback is the official latest close.
    const start = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const eodRes = await httpGet(TIINGO.key, `https://api.tiingo.com/tiingo/daily/${ticker}/prices?startDate=${start}&format=json`, { headers, budget });
    const eod = tiingoResponseSchema.safeParse(parseJson(TIINGO.key, eodRes.text, eodRes.endpoint));
    if (!eod.success) throw new ProviderError(TIINGO.key, "PARSE_ERROR", "Unexpected price response", eodRes.status, eodRes.endpoint);
    const eodQuote = parseTiingoEodQuote(security.ticker, eod.data);
    if (!eodQuote) throw new ProviderError(TIINGO.key, "NOT_FOUND", `No end-of-day close for ${security.ticker}`, eodRes.status, eodRes.endpoint);
    return { quote: eodQuote, meta: { endpoint: eodRes.endpoint, httpStatus: eodRes.status, payloadHash: eodRes.payloadHash, fetchedAt: new Date().toISOString() } };
  },
};
