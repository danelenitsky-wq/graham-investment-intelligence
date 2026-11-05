/**
 * Per-share and balance-sheet metrics used by the Graham rules and valuation
 * engines. All functions return null when inputs are missing: a missing value
 * is never treated as zero.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";

export type Num = number | null;

export function sortAnnual(annual: AnnualFinancials[]): AnnualFinancials[] {
  return [...annual].sort((a, b) => a.fiscalYear - b.fiscalYear);
}

export function latest(annual: AnnualFinancials[]): AnnualFinancials | null {
  const s = sortAnnual(annual);
  return s[s.length - 1] ?? null;
}

export function byYear(annual: AnnualFinancials[]): Map<number, AnnualFinancials> {
  return new Map(annual.map((a) => [a.fiscalYear, a]));
}

/** Diluted EPS, falling back to basic EPS, then net income / diluted shares. */
export function eps(a: AnnualFinancials | undefined | null): Num {
  if (!a) return null;
  const v = a.values;
  if (v.epsDiluted !== undefined) return v.epsDiluted;
  if (v.epsBasic !== undefined) return v.epsBasic;
  if (v.netIncome !== undefined && v.dilutedShares) return v.netIncome / v.dilutedShares;
  return null;
}

/** Earnings for the common stock in a year (net income, falling back to EPS sign). */
export function earningsForCommon(a: AnnualFinancials | undefined | null): Num {
  if (!a) return null;
  if (a.values.netIncome !== undefined) return a.values.netIncome;
  return eps(a);
}

export function average(values: Num[]): Num {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((s, v) => s + v, 0) / values.length;
}

/** Average EPS over the `n` fiscal years ending at `endYear` (all years required). */
export function averageEps(annual: AnnualFinancials[], n: number, endYear?: number): Num {
  const s = sortAnnual(annual);
  const last = endYear ?? s[s.length - 1]?.fiscalYear;
  if (last === undefined) return null;
  const map = byYear(s);
  const values: Num[] = [];
  for (let y = last - n + 1; y <= last; y++) values.push(eps(map.get(y)));
  return average(values);
}

export function currentRatio(a: AnnualFinancials | null): Num {
  const ca = a?.values.currentAssets;
  const cl = a?.values.currentLiabilities;
  if (ca === undefined || cl === undefined || cl <= 0) return null;
  return ca / cl;
}

/** Net current assets (working capital) = current assets − current liabilities. */
export function netCurrentAssets(a: AnnualFinancials | null): Num {
  const ca = a?.values.currentAssets;
  const cl = a?.values.currentLiabilities;
  if (ca === undefined || cl === undefined) return null;
  return ca - cl;
}

/**
 * Long-term debt. When the issuer reports no long-term-debt tag, we infer zero
 * only if total liabilities equal current liabilities (no non-current
 * liabilities at all); otherwise the value is unknown.
 */
export function longTermDebt(a: AnnualFinancials | null): Num {
  if (!a) return null;
  const v = a.values;
  if (v.longTermDebt !== undefined) return v.longTermDebt;
  if (v.totalLiabilities !== undefined && v.currentLiabilities !== undefined) {
    if (Math.abs(v.totalLiabilities - v.currentLiabilities) < 1) return 0;
  }
  return null;
}

/** Common stock equity: stockholders' equity less preferred stock. */
export function commonEquity(a: AnnualFinancials | null): Num {
  const eq = a?.values.stockholdersEquity;
  if (eq === undefined) return null;
  return eq - (a?.values.preferredStock ?? 0);
}

export function tangibleCommonEquity(a: AnnualFinancials | null): Num {
  const ce = commonEquity(a);
  if (ce === null) return null;
  return ce - (a?.values.goodwill ?? 0) - (a?.values.intangibleAssets ?? 0);
}

/** Shares for per-share balance-sheet values: period-end outstanding, else diluted weighted average. */
export function sharesForBookValue(a: AnnualFinancials | null): Num {
  const s = a?.values.sharesOutstanding ?? a?.values.dilutedShares;
  return s && s > 0 ? s : null;
}

function perShare(amount: Num, shares: Num): Num {
  if (amount === null || shares === null || shares <= 0) return null;
  return amount / shares;
}

export function bookValuePerShare(a: AnnualFinancials | null): Num {
  return perShare(commonEquity(a), sharesForBookValue(a));
}

export function tangibleBookValuePerShare(a: AnnualFinancials | null): Num {
  return perShare(tangibleCommonEquity(a), sharesForBookValue(a));
}

/**
 * Net current asset value ("net-net"): current assets less ALL liabilities
 * and preferred stock (Graham, Ch. 15 bargain issues).
 */
export function ncav(a: AnnualFinancials | null): Num {
  const ca = a?.values.currentAssets;
  const tl = a?.values.totalLiabilities;
  if (ca === undefined || tl === undefined) return null;
  return ca - tl - (a?.values.preferredStock ?? 0);
}

export function ncavPerShare(a: AnnualFinancials | null): Num {
  return perShare(ncav(a), sharesForBookValue(a));
}

export function ratio(numerator: Num, denominator: Num): Num {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

/** Compound annual growth rate between two positive values `years` apart. */
export function cagr(start: Num, end: Num, years: number): Num {
  if (start === null || end === null || start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

/** Fiscal years in which a dividend is evidenced by the statements. */
export function dividendYearsFromStatements(annual: AnnualFinancials[]): number[] {
  return annual
    .filter((a) => (a.values.dividendsPerShare ?? 0) > 0 || Math.abs(a.values.dividendsPaid ?? 0) > 0)
    .map((a) => a.fiscalYear);
}

// ───────────── sourced values with an explicit derivation note (engine v2) ─────────────

export type ValueNote = "inferredAbsent" | "derived" | "lowerBound" | "missing" | undefined;
export interface Noted {
  value: Num;
  note: ValueNote;
}

const reported = (v: number | undefined): Noted => (v === undefined ? { value: null, note: "missing" } : { value: v, note: undefined });

/**
 * A complete balance sheet: total assets, equity and either total liabilities
 * or total liabilities-and-equity are all tagged (registry AI-ABSENT-LINE).
 */
export function hasCompleteBalanceSheet(a: AnnualFinancials | null): boolean {
  const v = a?.values;
  if (!v) return false;
  return v.totalAssets !== undefined && v.stockholdersEquity !== undefined && (v.totalLiabilities !== undefined || v.liabilitiesAndEquity !== undefined);
}

/** A line that is not presented on a complete balance sheet is "none" (flagged); otherwise unknown. */
export function absentMeansNone(a: AnnualFinancials | null, concept: "preferredStock" | "goodwill" | "intangibleAssets" | "shortTermBorrowings"): Noted {
  const v = a?.values[concept];
  if (v !== undefined) return { value: v, note: undefined };
  return hasCompleteBalanceSheet(a) ? { value: 0, note: "inferredAbsent" } : { value: null, note: "missing" };
}

/** Total liabilities, derived as L&E − total equity when no total-liabilities line is tagged (registry X-TL). */
export function totalLiabilitiesNoted(a: AnnualFinancials | null): Noted {
  const v = a?.values;
  if (!v) return { value: null, note: "missing" };
  if (v.totalLiabilities !== undefined) return { value: v.totalLiabilities, note: undefined };
  const eq = v.totalEquityInclNci ?? v.stockholdersEquity;
  if (v.liabilitiesAndEquity !== undefined && eq !== undefined) return { value: v.liabilitiesAndEquity - eq, note: "derived" };
  return { value: null, note: "missing" };
}

export function longTermDebtNoted(a: AnnualFinancials | null): Noted {
  if (!a) return { value: null, note: "missing" };
  if (a.values.longTermDebt !== undefined) return { value: a.values.longTermDebt, note: undefined };
  const inferred = longTermDebt(a);
  return inferred === null ? { value: null, note: "missing" } : { value: inferred, note: "inferredAbsent" };
}

/**
 * Debt due within a year (registry AI-TOTAL-DEBT). The DebtCurrent tag already
 * includes short-term borrowings; current maturities of long-term debt do not.
 */
export function currentDebtNoted(a: AnnualFinancials | null, debtCurrentTag: string | undefined): Noted {
  const v = a?.values;
  if (!v || v.debtCurrent === undefined) {
    if (v?.shortTermBorrowings !== undefined) return { value: v.shortTermBorrowings, note: "lowerBound" };
    return { value: null, note: "missing" };
  }
  if (debtCurrentTag === "us-gaap:DebtCurrent") return { value: v.debtCurrent, note: undefined };
  const stb = absentMeansNone(a, "shortTermBorrowings");
  if (stb.value === null) return { value: v.debtCurrent, note: "lowerBound" };
  return { value: v.debtCurrent + stb.value, note: stb.note };
}

export function commonEquityNoted(a: AnnualFinancials | null): Noted {
  const eq = a?.values.stockholdersEquity;
  if (eq === undefined) return { value: null, note: "missing" };
  const pref = absentMeansNone(a, "preferredStock");
  if (pref.value === null) return { value: null, note: "missing" };
  return { value: eq - pref.value, note: pref.note };
}

export function sharesNoted(a: AnnualFinancials | null): Noted {
  const v = a?.values;
  if (v?.sharesOutstanding !== undefined && v.sharesOutstanding > 0) return { value: v.sharesOutstanding, note: undefined };
  if (v?.dilutedShares !== undefined && v.dilutedShares > 0) return { value: v.dilutedShares, note: "derived" };
  return { value: null, note: "missing" };
}

export { reported };
