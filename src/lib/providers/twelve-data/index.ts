import "server-only";
import { env } from "@/server/env";
import { httpGet, parseJson } from "../http";
import { ProviderError, type ProviderDescriptor, type QuoteProvider } from "../types";
import { parseTwelveDataQuote, twelveDataError, twelveDataQuoteSchema } from "./parse";

/**
 * Twelve Data free (Basic) plan — latest US quote with 52-week range
 * (GET /quote, 8 credits/min, 800/day). Fundamentals are paid and not used.
 */
export const TWELVE_DATA: ProviderDescriptor = {
  key: "twelve-data",
  name: "Twelve Data (free plan quotes)",
  capabilities: ["QUOTES"],
  markets: ["US"],
  baseUrl: "https://api.twelvedata.com",
  termsUrl: "https://twelvedata.com/terms",
  requiredEnv: ["TWELVE_DATA_API_KEY"],
  isDevFixture: false,
};

export const twelveDataQuotes: QuoteProvider = {
  descriptor: TWELVE_DATA,
  feed: () => "UNKNOWN",
  // 800 credits/day cannot sustain 60 s polling for a full session; on-demand only.
  supportsAutoRefresh: () => false,
  async getQuote(security) {
    const key = env().TWELVE_DATA_API_KEY;
    if (!key) throw new ProviderError(TWELVE_DATA.key, "NOT_CONFIGURED", "TWELVE_DATA_API_KEY is not set.");
    const symbol = security.ticker.replace(/-/g, ".").toUpperCase();
    const res = await httpGet(TWELVE_DATA.key, `${TWELVE_DATA.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}`, {
      headers: { Authorization: `apikey ${key}`, Accept: "application/json" },
    });
    const parsed = twelveDataQuoteSchema.safeParse(parseJson(TWELVE_DATA.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(TWELVE_DATA.key, "PARSE_ERROR", "Unexpected quote response", res.status, res.endpoint);
    const err = twelveDataError(parsed.data);
    if (err) {
      const code = err.code === 429 ? "RATE_LIMITED" : err.code === 404 || err.code === 400 ? "NOT_FOUND" : err.code === 403 ? "NOT_ENTITLED" : "HTTP_ERROR";
      throw new ProviderError(TWELVE_DATA.key, code, err.message, err.code, res.endpoint);
    }
    const quote = parseTwelveDataQuote(symbol, parsed.data);
    if (!quote) throw new ProviderError(TWELVE_DATA.key, "NOT_FOUND", `No quote for ${symbol}`, res.status, res.endpoint);
    return { quote, meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() } };
  },
};
