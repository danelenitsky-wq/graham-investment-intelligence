import type { AnnualFinancials } from "@/lib/normalization/statements";
import type { CanonicalConcept } from "@/lib/normalization/concepts";

/** Build a synthetic annual record for unit tests (test-only data, not market data). */
export function year(fiscalYear: number, values: Partial<Record<CanonicalConcept, number>>, currency = "USD"): AnnualFinancials {
  return { fiscalYear, periodEnd: `${fiscalYear}-12-31`, currency, values };
}

/** A healthy synthetic industrial company with `n` years ending at `lastYear`. */
export function healthyCompany(lastYear = 2024, n = 12, overrides: (fy: number) => Partial<Record<CanonicalConcept, number>> = () => ({})) {
  const out: AnnualFinancials[] = [];
  for (let i = 0; i < n; i++) {
    const fy = lastYear - n + 1 + i;
    const epsDiluted = 2 + i * 0.25; // steady growth
    out.push(
      year(fy, {
        revenue: 1_000_000_000,
        netIncome: epsDiluted * 10_000_000,
        epsDiluted,
        dilutedShares: 10_000_000,
        dividendsPerShare: 1,
        totalAssets: 2_000_000_000,
        currentAssets: 900_000_000,
        currentLiabilities: 300_000_000,
        longTermDebt: 400_000_000,
        totalLiabilities: 800_000_000,
        stockholdersEquity: 1_200_000_000,
        sharesOutstanding: 10_000_000,
        ...overrides(fy),
      }),
    );
  }
  return out;
}
