/**
 * Provider contracts. Each external data source implements one or more of
 * these interfaces; the rest of the platform depends only on the contracts.
 */
import type { NormalizationResult, SplitEvent } from "@/lib/normalization/statements";
import type { QuoteFeed } from "@/lib/freshness/quote";
import type { SourcedPeriod } from "@/lib/verification";
import type { BarRejection, NormalizedDividend, NormalizedPriceBar, NormalizedSplit } from "@/lib/normalization/market";

export type ProviderCapability = "REFERENCE" | "FUNDAMENTALS" | "PRICES" | "QUOTES" | "FILINGS" | "VERIFICATION";
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
  ): Promise<{ result: NormalizationResult; quarterly?: NormalizationResult; meta: FetchMeta }>;
}

/** A normalized latest quote. `sourceTimestamp` is the provider's trade/quote time, never our clock. */
export interface NormalizedQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null; // fraction (0.012 = +1.2%)
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  marketCap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  currency: string;
  exchange: string | null;
  sourceTimestamp: string;
  feed: QuoteFeed;
  delayMinutes: number | null;
  /** e.g. "IEX venue only" — shown next to the status. */
  feedNote: string | null;
}

export interface QuoteProvider {
  descriptor: ProviderDescriptor;
  /** Feed classification for the configured plan (REALTIME only when the provider documents it). */
  feed(): QuoteFeed;
  /** Whether polling every 60 s fits the configured plan's rate limits. */
  supportsAutoRefresh(): boolean;
  getQuote(security: SecurityRef): Promise<{ quote: NormalizedQuote; meta: FetchMeta }>;
}

export interface FilingRef {
  accessionNumber: string;
  form: string;
  filingDate: string; // YYYY-MM-DD
  acceptedAt: string | null; // ISO instant
  reportDate: string | null; // period end
  url: string;
}

/** Issuer reference data from the filings index (SEC submissions: SIC code, fiscal year end). */
export interface IssuerProfile {
  sicCode: string | null;
  sicDescription: string | null;
  /** 1–12, or null when not reported. */
  fiscalYearEndMonth: number | null;
}

export interface FilingsProvider {
  descriptor: ProviderDescriptor;
  /** Most recent periodic reports (10-K, 10-Q, 20-F, 40-F and amendments), newest first. */
  latestPeriodicFilings(security: SecurityRef): Promise<{ filings: FilingRef[]; meta: FetchMeta; profile?: IssuerProfile }>;
}

/** Independent statements source used to verify primary filings. */
export interface VerificationStatementsProvider {
  descriptor: ProviderDescriptor;
  /** Periods the configured plan can serve (default: both). */
  supportsPeriod?(period: "annual" | "quarter"): boolean;
  getStatements(security: SecurityRef, period: "annual" | "quarter"): Promise<{ periods: SourcedPeriod[]; currency: string | null; meta: FetchMeta }>;
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
  | "NOT_ENTITLED"
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
