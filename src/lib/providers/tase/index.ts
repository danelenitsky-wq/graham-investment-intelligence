import "server-only";
import { ProviderError, type FundamentalsProvider, type PriceProvider, type ProviderDescriptor } from "../types";

/**
 * Tel Aviv Stock Exchange — placeholder.
 *
 * The data model already supports TASE (Market.IL, ILS/ILA currency handling,
 * TASE security numbers). Israeli issuers file IFRS statements through MAYA /
 * MAGNA rather than SEC XBRL, so a dedicated provider is required. Until one is
 * licensed and implemented this provider reports NOT_CONFIGURED instead of
 * returning any data.
 */
export const TASE: ProviderDescriptor = {
  key: "tase",
  name: "Tel Aviv Stock Exchange (not yet implemented)",
  capabilities: ["PRICES", "FUNDAMENTALS"],
  markets: ["IL"],
  baseUrl: "https://www.tase.co.il",
  requiredEnv: ["TASE_API_KEY"],
  isDevFixture: false,
};

const notImplemented = () => {
  throw new ProviderError(TASE.key, "NOT_CONFIGURED", "TASE data provider is not implemented yet.");
};

export const tasePrices: PriceProvider = { descriptor: TASE, getDailyHistory: async () => notImplemented() };
export const taseFundamentals: FundamentalsProvider = { descriptor: TASE, getAnnualFinancials: async () => notImplemented() };
