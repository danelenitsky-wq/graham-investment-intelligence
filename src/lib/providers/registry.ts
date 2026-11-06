import "server-only";
import { env } from "@/server/env";
import { DEV_FIXTURE } from "./dev-fixture";
import { FINNHUB, finnhubQuotes } from "./finnhub";
import { FMP, fmpStatements } from "./fmp";
import { SEC_EDGAR, secEdgarFilings, secEdgarFundamentals, secEdgarReference } from "./sec-edgar";
import { TASE, TASE_DATAHUB, taseFundamentals, tasePrices } from "./tase";
import { BOI } from "./boi";
import { TIINGO, tiingoPrices, tiingoQuotes } from "./tiingo";
import { TWELVE_DATA, twelveDataQuotes } from "./twelve-data";
import type {
  FilingsProvider,
  FundamentalsProvider,
  MarketCode,
  PriceProvider,
  ProviderDescriptor,
  ProviderStatus,
  QuoteProvider,
  ReferenceProvider,
  VerificationStatementsProvider,
} from "./types";

/**
 * Free-first: every provider here works on a free plan. FMP is optional and is
 * only used, on its free Basic plan, to cross-check SEC statements.
 */
export const ALL_PROVIDERS: ProviderDescriptor[] = [SEC_EDGAR, TIINGO, FINNHUB, TWELVE_DATA, FMP, BOI, TASE_DATAHUB, TASE, DEV_FIXTURE];

function isSet(name: string): boolean {
  const e = env();
  switch (name) {
    case "SEC_USER_AGENT":
      return Boolean(e.SEC_USER_AGENT);
    case "TIINGO_API_KEY":
      return Boolean(e.TIINGO_API_KEY);
    case "FMP_API_KEY":
      return Boolean(e.FMP_API_KEY);
    case "FINNHUB_API_KEY":
      return Boolean(e.FINNHUB_API_KEY);
    case "TWELVE_DATA_API_KEY":
      return Boolean(e.TWELVE_DATA_API_KEY);
    case "ENABLE_DEV_FIXTURES":
      return e.ENABLE_DEV_FIXTURES;
    case "TASE_DATAHUB_API_KEY":
      return Boolean(e.TASE_DATAHUB_API_KEY);
    case "TASE_PRICES_LICENSED":
      return false; // no free TASE price feed exists; manual price updates instead
    default:
      return Boolean(process.env[name]);
  }
}

export function isConfigured(d: ProviderDescriptor): boolean {
  return d.key !== TASE.key && d.requiredEnv.every(isSet);
}

/** Configuration status for display. Reports which variables are missing, never their values. */
export function providerStatuses(): ProviderStatus[] {
  return ALL_PROVIDERS.map((d) => {
    const missingEnv = d.requiredEnv.filter((n) => !isSet(n));
    return { ...d, configured: isConfigured(d), missingEnv };
  });
}

/** Declared subscription plans (labels only, for display). */
export function providerPlans(): Record<string, string | null> {
  const e = env();
  return {
    tiingo: e.TIINGO_API_KEY ? (e.TIINGO_PLAN ?? "free") : null,
    finnhub: e.FINNHUB_API_KEY ? "free" : null,
    "twelve-data": e.TWELVE_DATA_API_KEY ? "free" : null,
    fmp: e.FMP_API_KEY ? "basic" : null,
  };
}

export function referenceProvider(): ReferenceProvider {
  return secEdgarReference;
}

export function fundamentalsProviderFor(market: MarketCode): FundamentalsProvider {
  return market === "IL" ? taseFundamentals : secEdgarFundamentals;
}

/** Daily history, dividends and splits: Tiingo end-of-day (free plan, 30+ years). */
export function priceProviderFor(market: MarketCode): PriceProvider {
  if (market === "IL") return tasePrices;
  return tiingoPrices;
}

/**
 * Ordered latest-quote providers: primary first, then fallbacks; the next one
 * also cross-checks the primary. Intraday sources first (Finnhub, Twelve Data,
 * both free plans, shown as Delayed), then Tiingo's official last close.
 * Empty when none is configured.
 */
export function quoteProvidersFor(market: MarketCode): QuoteProvider[] {
  if (market !== "US") return [];
  return [finnhubQuotes, twelveDataQuotes, tiingoQuotes].filter((p) => isConfigured(p.descriptor));
}

/** Independent statements source used to verify primary filings. */
export function verificationStatementsProviderFor(market: MarketCode): VerificationStatementsProvider | null {
  return market === "US" && isConfigured(FMP) ? fmpStatements : null;
}

export function filingsProviderFor(market: MarketCode): FilingsProvider | null {
  return market === "US" && isConfigured(SEC_EDGAR) ? secEdgarFilings : null;
}

export interface MarketCoverage {
  market: MarketCode;
  /** Automatic latest quotes from a configured provider. */
  automaticQuotes: boolean;
  /** Daily history (52-week range, dividends). */
  dailyHistory: boolean;
  fundamentals: boolean;
  /** Symbol validation against an exchange master. */
  symbolMaster: "SEC" | "TASE_DATAHUB" | null;
  /** Prices must be entered manually, with a timestamp and a source label. */
  manualPricesRequired: boolean;
}

/** What the free providers can do for each market, given the current configuration. */
export function marketCoverage(market: MarketCode): MarketCoverage {
  if (market === "IL") {
    return { market, automaticQuotes: false, dailyHistory: false, fundamentals: false, symbolMaster: isConfigured(TASE_DATAHUB) ? "TASE_DATAHUB" : null, manualPricesRequired: true };
  }
  const quotes = quoteProvidersFor("US").length > 0;
  return { market, automaticQuotes: quotes, dailyHistory: isConfigured(TIINGO), fundamentals: isConfigured(SEC_EDGAR), symbolMaster: "SEC", manualPricesRequired: !quotes && !isConfigured(TIINGO) };
}
