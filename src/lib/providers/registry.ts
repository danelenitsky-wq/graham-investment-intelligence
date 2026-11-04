import "server-only";
import { env } from "@/server/env";
import { DEV_FIXTURE } from "./dev-fixture";
import { FMP, fmpPrices, fmpQuotes, fmpStatements } from "./fmp";
import { SEC_EDGAR, secEdgarFilings, secEdgarFundamentals, secEdgarReference } from "./sec-edgar";
import { TASE, taseFundamentals, tasePrices } from "./tase";
import { TIINGO, tiingoPrices, tiingoQuotes } from "./tiingo";
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

export const ALL_PROVIDERS: ProviderDescriptor[] = [SEC_EDGAR, FMP, TIINGO, TASE, DEV_FIXTURE];

function isSet(name: string): boolean {
  const e = env();
  switch (name) {
    case "SEC_USER_AGENT":
      return Boolean(e.SEC_USER_AGENT);
    case "TIINGO_API_KEY":
      return Boolean(e.TIINGO_API_KEY);
    case "FMP_API_KEY":
      return Boolean(e.FMP_API_KEY);
    case "ENABLE_DEV_FIXTURES":
      return e.ENABLE_DEV_FIXTURES;
    case "TASE_API_KEY":
      return false; // provider not implemented yet
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
  return { fmp: e.FMP_API_KEY ? (e.FMP_PLAN ?? "basic") : null, tiingo: e.TIINGO_API_KEY ? (e.TIINGO_PLAN ?? "free") : null };
}

export function referenceProvider(): ReferenceProvider {
  return secEdgarReference;
}

export function fundamentalsProviderFor(market: MarketCode): FundamentalsProvider {
  return market === "IL" ? taseFundamentals : secEdgarFundamentals;
}

/** Daily history: Tiingo when configured (30+ years, dividends, splits), else FMP. */
export function priceProviderFor(market: MarketCode): PriceProvider {
  if (market === "IL") return tasePrices;
  if (!isConfigured(TIINGO) && isConfigured(FMP)) return fmpPrices;
  return tiingoPrices;
}

/** Ordered latest-quote providers: primary first, then fallbacks. Empty when none is configured. */
export function quoteProvidersFor(market: MarketCode): QuoteProvider[] {
  if (market !== "US") return [];
  return [fmpQuotes, tiingoQuotes].filter((p) => isConfigured(p.descriptor));
}

/** Independent statements source used to verify primary filings. */
export function verificationStatementsProviderFor(market: MarketCode): VerificationStatementsProvider | null {
  return market === "US" && isConfigured(FMP) ? fmpStatements : null;
}

export function filingsProviderFor(market: MarketCode): FilingsProvider | null {
  return market === "US" && isConfigured(SEC_EDGAR) ? secEdgarFilings : null;
}
