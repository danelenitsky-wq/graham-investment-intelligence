/**
 * Data freshness and validation (pure). Produces a report the UI renders as
 * badges and the Data Health page aggregates.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { daysBetween } from "@/lib/normalization/statements";

export type FreshnessLevel = "FRESH" | "AGING" | "STALE" | "MISSING";

export interface FreshnessThresholds {
  /** Calendar days after which the latest price is "aging" / "stale". */
  priceAgingDays: number;
  priceStaleDays: number;
  /** Months since the latest fiscal year end. */
  fundamentalsAgingMonths: number;
  fundamentalsStaleMonths: number;
}

export const DEFAULT_FRESHNESS: FreshnessThresholds = {
  priceAgingDays: 4, // covers a long weekend
  priceStaleDays: 10,
  fundamentalsAgingMonths: 15, // annual report normally filed within ~3 months of year end
  fundamentalsStaleMonths: 24,
};

export interface DatasetFreshness {
  level: FreshnessLevel;
  asOf: string | null;
  ageDays: number | null;
  isDevFixture: boolean;
}

export interface ValidationIssue {
  severity: "INFO" | "WARNING" | "ERROR";
  code: string;
  fiscalYear?: number;
  context?: Record<string, number | string | null>;
}

export interface FreshnessReport {
  prices: DatasetFreshness;
  fundamentals: DatasetFreshness;
  issues: ValidationIssue[];
  usesDevFixtureData: boolean;
}

export function priceFreshness(
  latestDate: string | null,
  today: string,
  isDevFixture: boolean,
  t: FreshnessThresholds = DEFAULT_FRESHNESS,
): DatasetFreshness {
  if (!latestDate) return { level: "MISSING", asOf: null, ageDays: null, isDevFixture };
  const age = daysBetween(latestDate, today);
  const level: FreshnessLevel = age > t.priceStaleDays ? "STALE" : age > t.priceAgingDays ? "AGING" : "FRESH";
  return { level, asOf: latestDate, ageDays: age, isDevFixture };
}

export function fundamentalsFreshness(
  latestPeriodEnd: string | null,
  today: string,
  isDevFixture: boolean,
  t: FreshnessThresholds = DEFAULT_FRESHNESS,
): DatasetFreshness {
  if (!latestPeriodEnd) return { level: "MISSING", asOf: null, ageDays: null, isDevFixture };
  const age = daysBetween(latestPeriodEnd, today);
  const months = age / 30.44;
  const level: FreshnessLevel =
    months > t.fundamentalsStaleMonths ? "STALE" : months > t.fundamentalsAgingMonths ? "AGING" : "FRESH";
  return { level, asOf: latestPeriodEnd, ageDays: age, isDevFixture };
}

const REL_TOLERANCE = 0.01;

/** Internal-consistency checks on normalized annual statements. */
export function validateAnnualFinancials(annual: AnnualFinancials[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sorted = [...annual].sort((a, b) => a.fiscalYear - b.fiscalYear);

  for (const a of sorted) {
    const v = a.values;
    const fy = a.fiscalYear;
    // Assets = Liabilities + Equity (equity incl. NCI when reported)
    const equity = v.totalEquityInclNci ?? v.stockholdersEquity;
    if (v.totalAssets !== undefined && v.totalLiabilities !== undefined && equity !== undefined) {
      const diff = Math.abs(v.totalAssets - (v.totalLiabilities + equity));
      if (v.totalAssets > 0 && diff / v.totalAssets > REL_TOLERANCE) {
        // Mezzanine items (redeemable NCI, temporary equity) legitimately sit between the two.
        issues.push({
          severity: "WARNING",
          code: "BALANCE_SHEET_MISMATCH",
          fiscalYear: fy,
          context: { totalAssets: v.totalAssets, liabilitiesPlusEquity: v.totalLiabilities + equity },
        });
      }
    }
    if (v.currentAssets !== undefined && v.totalAssets !== undefined && v.currentAssets > v.totalAssets * (1 + REL_TOLERANCE)) {
      issues.push({ severity: "ERROR", code: "CURRENT_ASSETS_EXCEED_TOTAL", fiscalYear: fy });
    }
    if (v.sharesOutstanding !== undefined && v.sharesOutstanding <= 0) {
      issues.push({ severity: "ERROR", code: "NON_POSITIVE_SHARES", fiscalYear: fy });
    }
    if (v.netIncome !== undefined && v.epsDiluted !== undefined && v.netIncome !== 0 && v.epsDiluted !== 0) {
      if (Math.sign(v.netIncome) !== Math.sign(v.epsDiluted)) {
        issues.push({ severity: "WARNING", code: "EPS_SIGN_MISMATCH", fiscalYear: fy });
      }
    }
    if (v.revenue !== undefined && v.revenue < 0) {
      issues.push({ severity: "WARNING", code: "NEGATIVE_REVENUE", fiscalYear: fy });
    }
  }

  // Gaps and suspicious share-count jumps (possible unadjusted split).
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.fiscalYear - prev.fiscalYear > 1) {
      issues.push({ severity: "WARNING", code: "MISSING_FISCAL_YEARS", fiscalYear: cur.fiscalYear, context: { previous: prev.fiscalYear } });
    }
    const a = prev.values.dilutedShares;
    const b = cur.values.dilutedShares;
    if (a && b && (b / a > 1.8 || a / b > 1.8)) {
      issues.push({
        severity: "WARNING",
        code: "SHARE_COUNT_JUMP",
        fiscalYear: cur.fiscalYear,
        context: { previousShares: a, shares: b },
      });
    }
  }

  const required = ["revenue", "netIncome", "totalAssets", "currentAssets", "currentLiabilities", "stockholdersEquity"] as const;
  const last = sorted[sorted.length - 1];
  if (last) {
    for (const k of required) {
      if (last.values[k] === undefined) {
        issues.push({ severity: "INFO", code: "MISSING_CONCEPT", fiscalYear: last.fiscalYear, context: { concept: k } });
      }
    }
  } else {
    issues.push({ severity: "WARNING", code: "NO_FINANCIALS" });
  }
  return issues;
}
