import "server-only";
import { env } from "@/server/env";
import { httpGet, parseJson } from "../http";
import { ProviderError, type FetchMeta, type ProviderDescriptor, type VerificationStatementsProvider } from "../types";
import { fmpStatementSchema, mergeFmpStatements } from "./parse";

/**
 * Financial Modeling Prep — OPTIONAL, supplementary only, free (Basic) plan.
 *
 * The application never requires a paid FMP plan. With FMP_API_KEY set, FMP's
 * annual income, balance-sheet and cash-flow statements are used as an
 * independent cross-check of the SEC figures. Nothing else is taken from FMP:
 * quotes, daily history, dividends and splits come from free providers.
 *
 * Basic plan limits (FMP pricing page): 250 calls/day, annual statements with
 * about 5 years of history, US symbols only. Quarterly statements are not
 * requested. Any endpoint FMP answers with "not included in your plan"
 * (HTTP 402 or an "Error Message") is recorded as NOT_ENTITLED and the
 * cross-check pauses for 24 h; the rest of the app is unaffected.
 */
export const FMP: ProviderDescriptor = {
  key: "fmp",
  name: "Financial Modeling Prep (optional, free Basic plan)",
  capabilities: ["VERIFICATION"],
  markets: ["US"],
  baseUrl: "https://financialmodelingprep.com/stable",
  termsUrl: "https://site.financialmodelingprep.com/terms-of-service",
  requiredEnv: ["FMP_API_KEY"],
  isDevFixture: false,
};

const BASE = "https://financialmodelingprep.com/stable";
/** Annual periods requested on the Basic plan. */
export const FMP_BASIC_ANNUAL_LIMIT = 5;

function key(): string {
  const k = env().FMP_API_KEY;
  if (!k) throw new ProviderError(FMP.key, "NOT_CONFIGURED", "FMP_API_KEY is not set.");
  return k;
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
    throw new ProviderError(FMP.key, /subscription|plan|premium|restricted|upgrade/i.test(msg) ? "NOT_ENTITLED" : "HTTP_ERROR", msg, res.status, res.endpoint);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ProviderError(FMP.key, "PARSE_ERROR", `Unexpected ${path} response`, res.status, res.endpoint);
  const meta: FetchMeta = { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() };
  return { data: parsed.data, meta };
}

export const fmpStatements: VerificationStatementsProvider = {
  descriptor: FMP,
  supportsPeriod: (period) => period === "annual",
  async getStatements(security, period) {
    if (period !== "annual") throw new ProviderError(FMP.key, "NOT_SUPPORTED", "Quarterly statements are not requested on the free FMP plan.");
    const symbol = fmpSymbol(security.ticker);
    const params = { symbol, period: "annual", limit: String(FMP_BASIC_ANNUAL_LIMIT) };
    const inc = await get("income-statement", params, fmpStatementSchema);
    const bal = await get("balance-sheet-statement", params, fmpStatementSchema);
    const cf = await get("cash-flow-statement", params, fmpStatementSchema);
    const merged = mergeFmpStatements(inc.data, bal.data, cf.data);
    return { ...merged, meta: { ...inc.meta, payloadHash: [inc.meta.payloadHash, bal.meta.payloadHash, cf.meta.payloadHash].join(":") } };
  },
};
