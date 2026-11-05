import "server-only";
import { normalizeCompanyFacts, normalizeQuarterlyFacts } from "@/lib/normalization/statements";
import { env } from "@/server/env";
import { httpGet, parseJson } from "../http";
import { ProviderError, type FilingsProvider, type FundamentalsProvider, type ProviderDescriptor, type ReferenceProvider } from "../types";
import { companyFactsSchema, submissionsSchema, tickerExchangeSchema } from "./types";
import { padCik, parsePeriodicFilings, parseTickerExchangeFile } from "./parse";

export const SEC_EDGAR: ProviderDescriptor = {
  key: "sec-edgar",
  name: "SEC EDGAR (XBRL company facts)",
  capabilities: ["REFERENCE", "FUNDAMENTALS", "FILINGS"],
  markets: ["US"],
  baseUrl: "https://data.sec.gov",
  termsUrl: "https://www.sec.gov/os/accessing-edgar-data",
  requiredEnv: ["SEC_USER_AGENT"],
  isDevFixture: false,
};

// SEC fair-access policy: max 10 requests/second, declared User-Agent required.
let lastRequest = 0;
async function throttle() {
  const wait = lastRequest + 120 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

function headers() {
  const ua = env().SEC_USER_AGENT;
  if (!ua) throw new ProviderError(SEC_EDGAR.key, "NOT_CONFIGURED", "SEC_USER_AGENT is not set (SEC requires a contact User-Agent).");
  return { "User-Agent": ua, Accept: "application/json" };
}

export const secEdgarReference: ReferenceProvider = {
  descriptor: SEC_EDGAR,
  async listUniverse() {
    const h = headers();
    await throttle();
    const res = await httpGet(SEC_EDGAR.key, "https://www.sec.gov/files/company_tickers_exchange.json", { headers: h });
    const parsed = tickerExchangeSchema.safeParse(parseJson(SEC_EDGAR.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(SEC_EDGAR.key, "PARSE_ERROR", "Unexpected ticker file format", res.status, res.endpoint);
    return {
      entries: parseTickerExchangeFile(parsed.data),
      meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() },
    };
  },
};

export const secEdgarFundamentals: FundamentalsProvider = {
  descriptor: SEC_EDGAR,
  async getAnnualFinancials(security, options) {
    if (!security.cik) throw new ProviderError(SEC_EDGAR.key, "NOT_SUPPORTED", `${security.ticker} has no SEC CIK`);
    const h = headers();
    await throttle();
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(security.cik)}.json`;
    const res = await httpGet(SEC_EDGAR.key, url, { headers: h, timeoutMs: 45_000 });
    const parsed = companyFactsSchema.safeParse(parseJson(SEC_EDGAR.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(SEC_EDGAR.key, "PARSE_ERROR", "Unexpected companyfacts format", res.status, res.endpoint);
    return {
      result: normalizeCompanyFacts(parsed.data, { splits: options?.splits }),
      quarterly: normalizeQuarterlyFacts(parsed.data, { splits: options?.splits }),
      meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() },
    };
  },
};

/** Latest periodic reports from the EDGAR submissions index (used by the daily new-filing check). */
export const secEdgarFilings: FilingsProvider = {
  descriptor: SEC_EDGAR,
  async latestPeriodicFilings(security) {
    if (!security.cik) throw new ProviderError(SEC_EDGAR.key, "NOT_SUPPORTED", `${security.ticker} has no SEC CIK`);
    const h = headers();
    await throttle();
    const res = await httpGet(SEC_EDGAR.key, `https://data.sec.gov/submissions/CIK${padCik(security.cik)}.json`, { headers: h });
    const parsed = submissionsSchema.safeParse(parseJson(SEC_EDGAR.key, res.text, res.endpoint));
    if (!parsed.success) throw new ProviderError(SEC_EDGAR.key, "PARSE_ERROR", "Unexpected submissions format", res.status, res.endpoint);
    return {
      filings: parsePeriodicFilings(parsed.data),
      meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() },
    };
  },
};
