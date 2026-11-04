/**
 * Graham rules engine — strictly the criteria of The Intelligent Investor,
 * fourth revised edition (1973).
 *
 *  - Defensive investor: Chapter 14, "Stock Selection for the Defensive
 *    Investor" (seven statistical requirements).
 *  - Enterprising investor: Chapter 15, "Stock Selection for the Enterprising
 *    Investor" (criteria for secondary companies / bargain issues).
 *
 * Thresholds are Graham's nominal 1973 figures. Any modern adaptation
 * (inflation adjustment, bond-yield scaling, ...) lives in
 * src/lib/valuation/modern.ts and is labelled MODERN_EXTENSION.
 *
 * Every rule is tri-state: it PASSes or FAILs only when the data proves it, and
 * otherwise reports INSUFFICIENT_DATA. Missing values are never treated as 0.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";
import {
  averageEps,
  bookValuePerShare,
  byYear,
  currentRatio,
  earningsForCommon,
  eps,
  latest,
  longTermDebt,
  netCurrentAssets,
  ratio,
  sortAnnual,
  tangibleBookValuePerShare,
  commonEquity,
  dividendYearsFromStatements,
  type Num,
} from "./metrics";
import type { GrahamInputs, RuleResult, RuleStatus, ScreenOutcome, ScreenResult } from "./types";

export const GRAHAM_ENGINE_VERSION = "1.0.0";

/** Graham's 1973 thresholds, exactly as printed. */
export const DEFENSIVE_THRESHOLDS = {
  minAnnualSalesUsd: 100_000_000, // industrial company
  minUtilityTotalAssetsUsd: 50_000_000, // public utility
  minCurrentRatio: 2,
  maxUtilityDebtToEquity: 2,
  earningsStabilityYears: 10,
  dividendRecordYears: 20,
  earningsGrowthYears: 10,
  minEarningsGrowth: 1 / 3,
  maxPeOnThreeYearAverage: 15,
  maxPriceToBook: 1.5,
  maxPeTimesPb: 22.5,
} as const;

export const ENTERPRISING_THRESHOLDS = {
  minCurrentRatio: 1.5,
  maxDebtToNetCurrentAssets: 1.1,
  earningsStabilityYears: 5,
  /** "Last year's earnings more than those of 1966" — written with 1971 as the last year. */
  earningsGrowthLookbackYears: 5,
  maxPriceToNetTangibleAssets: 1.2,
} as const;

const CH14 = { source: "INTELLIGENT_INVESTOR_1973", chapter: 14 } as const;
const CH15 = { source: "INTELLIGENT_INVESTOR_1973", chapter: 15 } as const;

function rule(r: Omit<RuleResult, "thresholds" | "measured"> & Partial<Pick<RuleResult, "thresholds" | "measured">>): RuleResult {
  return { measured: {}, thresholds: {}, ...r };
}

function toUsd(amount: Num, fxToUsd: number | null | undefined, currency: string | undefined): Num {
  if (amount === null) return null;
  if (currency === "USD") return amount;
  if (fxToUsd && fxToUsd > 0) return amount * fxToUsd;
  return null;
}

/** Ensure the price and the statements are in the same currency before mixing them. */
function priceInReportingCurrency(inputs: GrahamInputs, reportingCurrency: string | undefined): Num {
  if (!inputs.price) return null;
  if (!reportingCurrency || inputs.price.currency !== reportingCurrency) return null;
  return inputs.price.value;
}

// ───────────────────────────── shared rule helpers ─────────────────────────────

/** Positive earnings in each of the last `years` fiscal years. */
function earningsStability(annual: AnnualFinancials[], years: number): {
  status: RuleStatus;
  reason: string;
  measured: Record<string, number | null>;
} {
  const s = sortAnnual(annual);
  const last = s[s.length - 1];
  if (!last) return { status: "INSUFFICIENT_DATA", reason: "noFinancials", measured: {} };
  const map = byYear(s);
  let deficits = 0;
  let known = 0;
  for (let y = last.fiscalYear - years + 1; y <= last.fiscalYear; y++) {
    const e = earningsForCommon(map.get(y));
    if (e === null) continue;
    known++;
    if (e <= 0) deficits++;
  }
  const measured = { yearsWithData: known, deficitYears: deficits };
  if (deficits > 0) return { status: "FAIL", reason: "deficitYearFound", measured };
  if (known < years) return { status: "INSUFFICIENT_DATA", reason: "historyTooShort", measured };
  return { status: "PASS", reason: "positiveEveryYear", measured };
}

function dividendEvidence(inputs: GrahamInputs) {
  const paid = new Set([...(inputs.dividendYears ?? []), ...dividendYearsFromStatements(inputs.annual)]);
  // A year is "covered" when we hold its annual statements or provider dividend history.
  const covered = new Set([...(inputs.dividendCoverageYears ?? []), ...inputs.annual.map((a) => a.fiscalYear)]);
  return { paid, covered };
}

// ────────────────────────────── Defensive (Ch. 14) ─────────────────────────────

export function evaluateDefensive(inputs: GrahamInputs): ScreenResult {
  const T = DEFENSIVE_THRESHOLDS;
  const annual = sortAnnual(inputs.annual);
  const last = latest(annual);
  const currency = last?.currency;
  const rules: RuleResult[] = [];

  // 1. Adequate size of the enterprise
  {
    const assumptions = ["nominal1973Dollars"];
    if (inputs.isUtility) {
      const assets = toUsd(last?.values.totalAssets ?? null, inputs.fxToUsd, currency);
      rules.push(
        rule({
          id: "defensive.size",
          status: assets === null ? "INSUFFICIENT_DATA" : assets >= T.minUtilityTotalAssetsUsd ? "PASS" : "FAIL",
          reason: assets === null ? (last?.values.totalAssets === undefined ? "missingTotalAssets" : "needsFxRate") : "comparedUtilityAssets",
          measured: { totalAssetsUsd: assets },
          thresholds: { minTotalAssetsUsd: T.minUtilityTotalAssetsUsd },
          assumptions,
          citation: CH14,
        }),
      );
    } else {
      const sales = toUsd(last?.values.revenue ?? null, inputs.fxToUsd, currency);
      rules.push(
        rule({
          id: "defensive.size",
          status: sales === null ? "INSUFFICIENT_DATA" : sales >= T.minAnnualSalesUsd ? "PASS" : "FAIL",
          reason: sales === null ? (last?.values.revenue === undefined ? "missingRevenue" : "needsFxRate") : "comparedSales",
          measured: { annualSalesUsd: sales },
          thresholds: { minAnnualSalesUsd: T.minAnnualSalesUsd },
          assumptions,
          citation: CH14,
        }),
      );
    }
  }

  // 2. Sufficiently strong financial condition
  if (inputs.isUtility) {
    const debt = longTermDebt(last);
    const equity = commonEquity(last);
    const de = equity !== null && equity > 0 ? ratio(debt, equity) : null;
    rules.push(
      rule({
        id: "defensive.financialCondition",
        status: debt === null || equity === null ? "INSUFFICIENT_DATA" : equity <= 0 ? "FAIL" : de! <= T.maxUtilityDebtToEquity ? "PASS" : "FAIL",
        reason: debt === null ? "missingLongTermDebt" : equity === null ? "missingEquity" : equity <= 0 ? "negativeEquity" : "comparedUtilityDebt",
        measured: { debtToEquity: de, longTermDebt: debt, commonEquity: equity },
        thresholds: { maxDebtToEquity: T.maxUtilityDebtToEquity },
        citation: CH14,
      }),
    );
  } else {
    const cr = currentRatio(last);
    const nca = netCurrentAssets(last);
    const ltd = longTermDebt(last);
    let status: RuleStatus;
    let reason: string;
    if (cr === null || nca === null) {
      status = "INSUFFICIENT_DATA";
      reason = "missingCurrentItems";
    } else if (cr < T.minCurrentRatio) {
      status = "FAIL"; // fails regardless of debt
      reason = "currentRatioTooLow";
    } else if (ltd === null) {
      status = "INSUFFICIENT_DATA";
      reason = "missingLongTermDebt";
    } else if (ltd > nca) {
      status = "FAIL";
      reason = "debtExceedsWorkingCapital";
    } else {
      status = "PASS";
      reason = "strongCondition";
    }
    rules.push(
      rule({
        id: "defensive.financialCondition",
        status,
        reason,
        measured: { currentRatio: cr, netCurrentAssets: nca, longTermDebt: ltd },
        thresholds: { minCurrentRatio: T.minCurrentRatio, maxDebtToNetCurrentAssets: 1 },
        citation: CH14,
      }),
    );
  }

  // 3. Earnings stability: some earnings for the common stock in each of the past ten years
  {
    const r = earningsStability(annual, T.earningsStabilityYears);
    rules.push(
      rule({
        id: "defensive.earningsStability",
        ...r,
        thresholds: { years: T.earningsStabilityYears },
        citation: CH14,
      }),
    );
  }

  // 4. Dividend record: uninterrupted payments for at least the past 20 years
  {
    const { paid, covered } = dividendEvidence(inputs);
    const lastYear = last?.fiscalYear;
    let status: RuleStatus = "INSUFFICIENT_DATA";
    let reason = "noFinancials";
    let consecutive = 0;
    if (lastYear !== undefined) {
      for (let y = lastYear; y > lastYear - T.dividendRecordYears; y--) {
        if (paid.has(y)) consecutive++;
        else break;
      }
      const window = Array.from({ length: T.dividendRecordYears }, (_, i) => lastYear - i);
      const provenGap = window.some((y) => covered.has(y) && !paid.has(y));
      if (provenGap) {
        status = "FAIL";
        reason = "dividendGapFound";
      } else if (window.every((y) => paid.has(y))) {
        status = "PASS";
        reason = "uninterruptedDividends";
      } else {
        status = "INSUFFICIENT_DATA";
        reason = "dividendHistoryTooShort";
      }
    }
    rules.push(
      rule({
        id: "defensive.dividendRecord",
        status,
        reason,
        measured: { consecutiveDividendYears: consecutive, yearsCovered: covered.size },
        thresholds: { years: T.dividendRecordYears },
        assumptions: ["dividendCoverage"],
        citation: CH14,
      }),
    );
  }

  // 5. Earnings growth: ≥ one-third increase in per-share earnings over ten years, three-year averages at both ends
  {
    const lastYear = last?.fiscalYear;
    let start: Num = null;
    let end: Num = null;
    if (lastYear !== undefined) {
      end = averageEps(annual, 3, lastYear);
      start = averageEps(annual, 3, lastYear - T.earningsGrowthYears + 3);
    }
    const growth = start !== null && end !== null && start > 0 ? end / start - 1 : null;
    rules.push(
      rule({
        id: "defensive.earningsGrowth",
        status: start === null || end === null ? "INSUFFICIENT_DATA" : start <= 0 ? "INSUFFICIENT_DATA" : growth! >= T.minEarningsGrowth ? "PASS" : "FAIL",
        reason: start === null || end === null ? "historyTooShort" : start <= 0 ? "nonPositiveBase" : "comparedGrowth",
        measured: { startAverageEps: start, endAverageEps: end, growth },
        thresholds: { minGrowth: T.minEarningsGrowth, years: T.earningsGrowthYears },
        assumptions: ["tenYearWindowInclusive", "dilutedEps"],
        citation: CH14,
      }),
    );
  }

  // 6. Moderate price/earnings ratio: price ≤ 15 × average earnings of the past three years
  const price = priceInReportingCurrency(inputs, currency);
  const avg3 = averageEps(annual, 3);
  const pe3 = price !== null && avg3 !== null && avg3 > 0 ? price / avg3 : null;
  rules.push(
    rule({
      id: "defensive.moderatePe",
      status:
        price === null || avg3 === null ? "INSUFFICIENT_DATA" : avg3 <= 0 ? "FAIL" : pe3! <= T.maxPeOnThreeYearAverage ? "PASS" : "FAIL",
      reason:
        price === null ? (inputs.price ? "priceCurrencyMismatch" : "missingPrice") : avg3 === null ? "historyTooShort" : avg3 <= 0 ? "nonPositiveEarnings" : "comparedPe",
      measured: { price, averageEps3y: avg3, pe3y: pe3 },
      thresholds: { maxPe: T.maxPeOnThreeYearAverage },
      citation: CH14,
    }),
  );

  // 7. Moderate ratio of price to assets: P/B ≤ 1.5, or P/E × P/B ≤ 22.5
  {
    const bvps = bookValuePerShare(last);
    const pb = price !== null && bvps !== null && bvps > 0 ? price / bvps : null;
    const product = pb !== null && pe3 !== null ? pb * pe3 : null;
    let status: RuleStatus;
    let reason: string;
    if (price === null || bvps === null) {
      status = "INSUFFICIENT_DATA";
      reason = price === null ? "missingPrice" : "missingBookValue";
    } else if (bvps <= 0) {
      status = "FAIL";
      reason = "nonPositiveBookValue";
    } else if (pb! <= T.maxPriceToBook) {
      status = "PASS";
      reason = "pbWithinLimit";
    } else if (product !== null) {
      status = product <= T.maxPeTimesPb ? "PASS" : "FAIL";
      reason = "comparedProduct";
    } else {
      // P/B above 1.5 and the P/E side of the product is unknown (or earnings non-positive)
      status = avg3 !== null && avg3 <= 0 ? "FAIL" : "INSUFFICIENT_DATA";
      reason = avg3 !== null && avg3 <= 0 ? "nonPositiveEarnings" : "historyTooShort";
    }
    rules.push(
      rule({
        id: "defensive.moderatePriceToAssets",
        status,
        reason,
        measured: { bookValuePerShare: bvps, priceToBook: pb, peTimesPb: product },
        thresholds: { maxPriceToBook: T.maxPriceToBook, maxPeTimesPb: T.maxPeTimesPb },
        assumptions: ["bookValueCommonEquity"],
        citation: CH14,
      }),
    );
  }

  return summarize("DEFENSIVE", rules);
}

// ──────────────────────────── Enterprising (Ch. 15) ────────────────────────────

export function evaluateEnterprising(
  inputs: GrahamInputs,
  options: { earningsGrowthLookbackYears?: number } = {},
): ScreenResult {
  const T = ENTERPRISING_THRESHOLDS;
  const lookback = options.earningsGrowthLookbackYears ?? T.earningsGrowthLookbackYears;
  const annual = sortAnnual(inputs.annual);
  const last = latest(annual);
  const currency = last?.currency;
  const rules: RuleResult[] = [];

  // 1. Financial condition: current ratio ≥ 1.5 and debt ≤ 110% of net current assets
  {
    const cr = currentRatio(last);
    const nca = netCurrentAssets(last);
    const ltd = longTermDebt(last);
    let status: RuleStatus;
    let reason: string;
    if (cr === null || nca === null) {
      status = "INSUFFICIENT_DATA";
      reason = "missingCurrentItems";
    } else if (cr < T.minCurrentRatio) {
      status = "FAIL";
      reason = "currentRatioTooLow";
    } else if (ltd === null) {
      status = "INSUFFICIENT_DATA";
      reason = "missingLongTermDebt";
    } else if (nca <= 0 ? ltd > 0 : ltd > T.maxDebtToNetCurrentAssets * nca) {
      status = "FAIL";
      reason = "debtExceedsWorkingCapital";
    } else {
      status = "PASS";
      reason = "strongCondition";
    }
    rules.push(
      rule({
        id: "enterprising.financialCondition",
        status,
        reason,
        measured: { currentRatio: cr, netCurrentAssets: nca, longTermDebt: ltd, debtToNetCurrentAssets: ratio(ltd, nca) },
        thresholds: { minCurrentRatio: T.minCurrentRatio, maxDebtToNetCurrentAssets: T.maxDebtToNetCurrentAssets },
        citation: CH15,
      }),
    );
  }

  // 2. Earnings stability: no deficit in the last five years
  {
    const r = earningsStability(annual, T.earningsStabilityYears);
    rules.push(rule({ id: "enterprising.earningsStability", ...r, thresholds: { years: T.earningsStabilityYears }, citation: CH15 }));
  }

  // 3. Dividend record: some current dividend
  {
    const { paid, covered } = dividendEvidence(inputs);
    const y = last?.fiscalYear;
    const status: RuleStatus = y === undefined ? "INSUFFICIENT_DATA" : paid.has(y) ? "PASS" : covered.has(y) ? "FAIL" : "INSUFFICIENT_DATA";
    rules.push(
      rule({
        id: "enterprising.dividendRecord",
        status,
        reason: status === "PASS" ? "currentDividendPaid" : status === "FAIL" ? "noCurrentDividend" : "noFinancials",
        measured: { latestFiscalYear: y ?? null },
        assumptions: ["dividendCoverage"],
        citation: CH15,
      }),
    );
  }

  // 4. Earnings growth: last year's earnings more than those of N years earlier
  {
    const map = byYear(annual);
    const y = last?.fiscalYear;
    const now = y !== undefined ? eps(map.get(y)) : null;
    const then = y !== undefined ? eps(map.get(y - lookback)) : null;
    rules.push(
      rule({
        id: "enterprising.earningsGrowth",
        status: now === null || then === null ? "INSUFFICIENT_DATA" : now > then ? "PASS" : "FAIL",
        reason: now === null || then === null ? "historyTooShort" : "comparedGrowth",
        measured: { latestEps: now, baseEps: then },
        thresholds: { lookbackYears: lookback },
        assumptions: ["enterprisingLookback"],
        citation: CH15,
      }),
    );
  }

  // 5. Price: less than 120% of net tangible assets
  {
    const price = priceInReportingCurrency(inputs, currency);
    const tbvps = tangibleBookValuePerShare(last);
    const pt = price !== null && tbvps !== null && tbvps > 0 ? price / tbvps : null;
    rules.push(
      rule({
        id: "enterprising.priceToTangibleAssets",
        status:
          price === null || tbvps === null ? "INSUFFICIENT_DATA" : tbvps <= 0 ? "FAIL" : pt! < T.maxPriceToNetTangibleAssets ? "PASS" : "FAIL",
        reason:
          price === null ? (inputs.price ? "priceCurrencyMismatch" : "missingPrice") : tbvps === null ? "missingBookValue" : tbvps <= 0 ? "nonPositiveBookValue" : "comparedTangible",
        measured: { price, tangibleBookValuePerShare: tbvps, priceToTangibleBook: pt },
        thresholds: { maxPriceToNetTangibleAssets: T.maxPriceToNetTangibleAssets },
        citation: CH15,
      }),
    );
  }

  return summarize("ENTERPRISING", rules);
}

function summarize(screen: ScreenResult["screen"], rules: RuleResult[]): ScreenResult {
  const passed = rules.filter((r) => r.status === "PASS").length;
  const failed = rules.filter((r) => r.status === "FAIL").length;
  const insufficient = rules.filter((r) => r.status === "INSUFFICIENT_DATA").length;
  const outcome: ScreenOutcome = failed > 0 ? "FAILS_ONE_OR_MORE" : insufficient > 0 ? "INCOMPLETE_DATA" : "MEETS_ALL";
  return { screen, engineVersion: GRAHAM_ENGINE_VERSION, methodology: "GRAHAM_1973", outcome, passed, failed, insufficient, rules };
}
