import "server-only";
import { env } from "@/server/env";
import type { QuoteFeed } from "@/lib/freshness/quote";
import { makeBar, validatePriceBars } from "@/lib/normalization/market";
import { httpGet, parseJson } from "../http";
import {
  ProviderError,
  type FetchMeta,
  type PriceProvider,
  type ProviderDescriptor,
  type QuoteProvider,
  type SecurityRef,
  type VerificationStatementsProvider,
} from "../types";
import {
  fmpAdjEodSchema,
  fmpDividendsSchema,
  fmpEodSchema,
  fmpProfileSchema,
  fmpQuoteSchema,
  fmpSplitsSchema,
  fmpStatementSchema,
  mergeFmpStatements,
  parseFmpDividends,
  parseFmpQuote,
  parseFmpSplits,
} from "./parse";

/**
 * Financial Modeling Prep — primary provider for latest quotes, and an
 * independent source used to verify SEC filings and Tiingo price history.
 *
 * Plans (per FMP's pricing page): Basic is free, end-of-day only, 250 calls/day;
 * Starter and above include real-time US quotes (300+ calls/min). The plan is
 * declared with FMP_PLAN; nothing is labelled real-time unless a paid plan is declared.
 */
export const FMP: ProviderDescriptor = {
  key: "fmp",
  name: "Financial Modeling Prep",
  capabilities: ["QUOTES", "PRICES", "VERIFICATION"],
  markets: ["US"],
  baseUrl: "https://financialmodelingprep.com/stable",
  termsUrl: "https://site.financialmodelingprep.com/terms-of-service",
  requiredEnv: ["FMP_API_KEY"],
  isDevFixture: false,
};

const BASE = "https://financialmodelingprep.com/stable";
const PAID_PLANS = new Set(["starter", "premium", "ultimate", "enterprise"]);

function key(): string {
  const k = env().FMP_API_KEY;
  if (!k) throw new ProviderError(FMP.key, "NOT_CONFIGURED", "FMP_API_KEY is not set.");
  return k;
}

export function fmpPlanFeed(plan: string | undefined): QuoteFeed {
  // Basic (free) does not document real-time delivery: treat as unconfirmed (shown as Delayed at best, never Live).
  return plan && PAID_PLANS.has(plan) ? "REALTIME" : "UNKNOWN";
}

/** FMP uses "-" for share classes (BRK-B). */
export function fmpSymbol(ticker: string) {
  return ticker.replace(/\./g, "-").toUpperCase();
}

async function get<T>(path: string, params: Record<string, string>, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }) {
  const qs = new URLSearchParams({ ...params, apikey: key() });
  const res = await httpGet(FMP.key, `${BASE}/${path}?${qs}`, { secretParams: ["apikey"], headers: { Accept: "application/json" } });
  const json = parseJson<unknown>(FMP.key, res.text, res.endpoint);
  // FMP reports some errors as 200 + {"Error Message": "..."}.
  if (json && typeof json === "object" && !Array.isArray(json) && "Error Message" in json) {
    const msg = String((json as Record<string, unknown>)["Error Message"]).slice(0, 200);
    throw new ProviderError(FMP.key, /subscription|plan|premium|restricted/i.test(msg) ? "NOT_ENTITLED" : "HTTP_ERROR", msg, res.status, res.endpoint);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ProviderError(FMP.key, "PARSE_ERROR", `Unexpected ${path} response`, res.status, res.endpoint);
  const meta: FetchMeta = { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() };
  return { data: parsed.data, meta };
}

export const fmpQuotes: QuoteProvider = {
  descriptor: FMP,
  feed: () => fmpPlanFeed(env().FMP_PLAN),
  // 60 s polling = 1,440 calls/day per open page: only paid plans have that headroom.
  supportsAutoRefresh: () => fmpPlanFeed(env().FMP_PLAN) === "REALTIME",
  async getQuote(security: SecurityRef) {
    const symbol = fmpSymbol(security.ticker);
    const { data, meta } = await get("quote", { symbol }, fmpQuoteSchema);
    const quote = parseFmpQuote(data, { currency: "USD", feed: fmpQuotes.feed(), delayMinutes: null });
    if (!quote) throw new ProviderError(FMP.key, "NOT_FOUND", `No quote for ${symbol}`, meta.httpStatus, meta.endpoint);
    return { quote, meta };
  },
};

export async function fmpProfile(security: SecurityRef) {
  const { data, meta } = await get("profile", { symbol: fmpSymbol(security.ticker) }, fmpProfileSchema);
  return { profile: data[0] ?? null, meta };
}

export const fmpStatements: VerificationStatementsProvider = {
  descriptor: FMP,
  async getStatements(security, period) {
    const symbol = fmpSymbol(security.ticker);
    const params = { symbol, period, limit: period === "annual" ? "15" : "20" };
    const inc = await get("income-statement", params, fmpStatementSchema);
    const bal = await get("balance-sheet-statement", params, fmpStatementSchema);
    const cf = await get("cash-flow-statement", params, fmpStatementSchema);
    const merged = mergeFmpStatements(inc.data, bal.data, cf.data);
    return { ...merged, meta: { ...inc.meta, payloadHash: [inc.meta.payloadHash, bal.meta.payloadHash, cf.meta.payloadHash].join(":") } };
  },
};

/** Daily history from FMP (used when Tiingo is not configured). */
export const fmpPrices: PriceProvider = {
  descriptor: FMP,
  async getDailyHistory(security, range) {
    const symbol = fmpSymbol(security.ticker);
    const full = await get("historical-price-eod/full", { symbol, from: range.start, to: range.end }, fmpEodSchema);
    const adj = await get("historical-price-eod/dividend-adjusted", { symbol, from: range.start, to: range.end }, fmpAdjEodSchema);
    const divs = await get("dividends", { symbol }, fmpDividendsSchema);
    const splits = await get("splits", { symbol }, fmpSplitsSchema);
    const adjByDate = new Map(adj.data.map((r) => [r.date.slice(0, 10), r.adjClose ?? null]));
    const bars = full.data
      .map((r) => makeBar({ ...r, adjClose: adjByDate.get(r.date.slice(0, 10)) ?? null, currency: "USD" }))
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const validated = validatePriceBars(bars);
    return {
      bars: validated.bars,
      rejected: validated.rejected,
      dividends: parseFmpDividends(divs.data, "USD"),
      splits: parseFmpSplits(splits.data),
      meta: full.meta,
    };
  },
};
