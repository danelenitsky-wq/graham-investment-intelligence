/**
 * Provider contracts. Each external data source implements one or more of
 * these interfaces; the rest of the platform depends only on the contracts.
 */
import type { NormalizationResult, SplitEvent } from "@/lib/normalization/statements";
import type { BarRejection, NormalizedDividend, NormalizedPriceBar, NormalizedSplit } from "@/lib/normalization/market";

export type ProviderCapability = "REFERENCE" | "FUNDAMENTALS" | "PRICES";
export type MarketCode = "US" | "IL";

export interface ProviderDescriptor {
  key: string;
  name: string;
  capabilities: ProviderCapability[];
  markets: MarketCode[];
  baseUrl: string;
  termsUrl?: string;
  /** Environment variables the provider needs (names only — values stay server-side). */
  requiredEnv: string[];
  isDevFixture: boolean;
}

export interface ProviderStatus extends ProviderDescriptor {
  configured: boolean;
  missingEnv: string[];
}

export interface FetchMeta {
  /** Request URL with any credentials removed. */
  endpoint: string;
  httpStatus: number | null;
  payloadHash: string | null;
  fetchedAt: string;
}

export interface UniverseEntry {
  ticker: string;
  name: string;
  exchangeCode: string; // canonical exchange code, e.g. NASDAQ, NYSE
  cik: string | null;
}

export interface SecurityRef {
  ticker: string;
  exchangeCode: string;
  cik: string | null;
  taseSecurityNumber?: string | null;
}

export interface ReferenceProvider {
  descriptor: ProviderDescriptor;
  listUniverse(): Promise<{ entries: UniverseEntry[]; meta: FetchMeta }>;
}

export interface FundamentalsProvider {
  descriptor: ProviderDescriptor;
  getAnnualFinancials(
    security: SecurityRef,
    options?: { splits?: SplitEvent[] },
  ): Promise<{ result: NormalizationResult; meta: FetchMeta }>;
}

export interface PriceHistory {
  bars: NormalizedPriceBar[];
  rejected: BarRejection[];
  dividends: NormalizedDividend[];
  splits: NormalizedSplit[];
  meta: FetchMeta;
}

export interface PriceProvider {
  descriptor: ProviderDescriptor;
  getDailyHistory(security: SecurityRef, range: { start: string; end: string }): Promise<PriceHistory>;
}

export type ProviderErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_SUPPORTED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "PARSE_ERROR";

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly httpStatus: number | null = null,
    public readonly endpoint: string | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
