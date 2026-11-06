import "server-only";
import { env } from "@/server/env";
import { httpGet, parseJson } from "../http";
import { ProviderError, type FetchMeta, type FundamentalsProvider, type PriceProvider, type ProviderDescriptor } from "../types";
import { parseTradeSecuritiesList, type TaseSecurityRef } from "./parse";

/**
 * Tel Aviv Stock Exchange — exchange-aware adapter.
 *
 * Coverage of lawful free sources (investigated 2026-11-06, see docs/TASE.md):
 * - TASE Data Hub "Securities Basic" (free with a free API key): list of
 *   traded securities with symbol, TASE security number, ISIN and company.
 *   Used for symbol validation and mapping. No prices.
 * - TASE Data Hub end-of-day / intraday securities data: paid products that
 *   need commercial approval. Not used.
 * - Israeli issuers' IFRS statements (MAYA / MAGNA) have no free structured
 *   (XBRL-like) API comparable to SEC EDGAR. Not used.
 *
 * Therefore TASE prices come from manual price updates (explicit timestamp,
 * unit ILS or agorot, and source label), and TASE fundamentals are
 * unavailable. Both providers below refuse with NOT_SUPPORTED instead of
 * returning anything.
 */
export const TASE: ProviderDescriptor = {
  key: "tase",
  name: "Tel Aviv Stock Exchange prices and IFRS fundamentals (no free source)",
  capabilities: ["PRICES", "FUNDAMENTALS"],
  markets: ["IL"],
  baseUrl: "https://www.tase.co.il",
  requiredEnv: ["TASE_PRICES_LICENSED"],
  isDevFixture: false,
};

export const TASE_DATAHUB: ProviderDescriptor = {
  key: "tase-datahub",
  name: "TASE Data Hub — Securities Basic (symbols, security numbers, ISIN)",
  capabilities: ["REFERENCE"],
  markets: ["IL"],
  baseUrl: "https://datawise.tase.co.il/v1",
  termsUrl: "https://openapi.tase.co.il/tase/prod/about",
  requiredEnv: ["TASE_DATAHUB_API_KEY"],
  isDevFixture: false,
};

const unsupported = (what: string) => () => {
  throw new ProviderError(TASE.key, "NOT_SUPPORTED", `${what} for TASE securities are not available from a free source. Use a manual price update with its timestamp and source.`);
};

export const tasePrices: PriceProvider = { descriptor: TASE, getDailyHistory: async () => unsupported("Daily prices")() };
export const taseFundamentals: FundamentalsProvider = { descriptor: TASE, getAnnualFinancials: async () => unsupported("Financial statements")() };

/** Securities traded on a given day (Securities Basic). Throws NOT_CONFIGURED without a key. */
export async function taseTradedSecurities(date: string, language: "en-US" | "he-IL" = "en-US"): Promise<{ securities: TaseSecurityRef[]; meta: FetchMeta }> {
  const key = env().TASE_DATAHUB_API_KEY;
  if (!key) throw new ProviderError(TASE_DATAHUB.key, "NOT_CONFIGURED", "TASE_DATAHUB_API_KEY is not set.");
  const [y, m, d] = date.split("-").map(Number);
  const url = `${TASE_DATAHUB.baseUrl}/basic-securities/trade-securities-list/${y}/${m}/${d}`;
  const res = await httpGet(TASE_DATAHUB.key, url, { headers: { apikey: key, accept: "application/json", "accept-language": language } });
  const securities = parseTradeSecuritiesList(parseJson(TASE_DATAHUB.key, res.text, res.endpoint));
  if (!securities) throw new ProviderError(TASE_DATAHUB.key, "PARSE_ERROR", "Unexpected trade-securities-list response", res.status, res.endpoint);
  return { securities, meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() } };
}
