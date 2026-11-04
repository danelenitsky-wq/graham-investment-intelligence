import "server-only";
import { env } from "@/server/env";
import { DEV_FIXTURE } from "./dev-fixture";
import { SEC_EDGAR, secEdgarFundamentals, secEdgarReference } from "./sec-edgar";
import { TASE, taseFundamentals, tasePrices } from "./tase";
import { TIINGO, tiingoPrices } from "./tiingo";
import type { FundamentalsProvider, MarketCode, PriceProvider, ProviderDescriptor, ProviderStatus, ReferenceProvider } from "./types";

export const ALL_PROVIDERS: ProviderDescriptor[] = [SEC_EDGAR, TIINGO, TASE, DEV_FIXTURE];

function isSet(name: string): boolean {
  const e = env();
  switch (name) {
    case "SEC_USER_AGENT":
      return Boolean(e.SEC_USER_AGENT);
    case "TIINGO_API_KEY":
      return Boolean(e.TIINGO_API_KEY);
    case "ENABLE_DEV_FIXTURES":
      return e.ENABLE_DEV_FIXTURES;
    case "TASE_API_KEY":
      return false; // provider not implemented yet
    default:
      return Boolean(process.env[name]);
  }
}

/** Configuration status for display. Reports which variables are missing, never their values. */
export function providerStatuses(): ProviderStatus[] {
  return ALL_PROVIDERS.map((d) => {
    const missingEnv = d.requiredEnv.filter((n) => !isSet(n));
    return { ...d, configured: missingEnv.length === 0 && d.key !== TASE.key, missingEnv };
  });
}

export function referenceProvider(): ReferenceProvider {
  return secEdgarReference;
}

export function fundamentalsProviderFor(market: MarketCode): FundamentalsProvider {
  return market === "IL" ? taseFundamentals : secEdgarFundamentals;
}

export function priceProviderFor(market: MarketCode): PriceProvider {
  return market === "IL" ? tasePrices : tiingoPrices;
}
