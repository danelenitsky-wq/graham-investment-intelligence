/**
 * MODERN EXTENSIONS — deliberately separated from the 1973 methodology.
 *
 * None of these appear in The Intelligent Investor (1973). They are common
 * modern adaptations and are always labelled MODERN_EXTENSION in the UI.
 * Inputs that depend on outside facts (CPI, bond yields) must be supplied by
 * the user or a macro data provider; this module never assumes them.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { commonEquity, latest, longTermDebt, ratio, type Num } from "@/lib/graham/metrics";
import type { RuleStatus } from "@/lib/graham/types";

/** Result shape of the legacy modern size check (superseded in the UI by the Graham engine's D1-M). */
export interface ModernCheckResult {
  id: string;
  status: RuleStatus;
  reason: string;
  measured: Record<string, number | null>;
  thresholds: Record<string, number>;
  assumptions?: string[];
  citation: { source: "INTELLIGENT_INVESTOR_1973"; chapter: number; note?: string };
}
import type { ValueEstimate } from "./graham";
import { DEFENSIVE_THRESHOLDS } from "@/lib/graham/rules";

/** BLS CPI-U, U.S. city average, annual average 1972 (1982-84 = 100). */
export const CPI_U_1972_ANNUAL_AVERAGE = 41.8;

/**
 * Inflation-adjusted version of Graham's "adequate size" test. Requires the
 * current CPI-U level from the user (Settings) — no default is assumed.
 */
export function inflationAdjustedSize(params: {
  annual: AnnualFinancials[];
  isUtility: boolean;
  currentCpi: number | null;
  fxToUsd?: number | null;
}): ModernCheckResult {
  const last = latest(params.annual);
  const factor = params.currentCpi && params.currentCpi > 0 ? params.currentCpi / CPI_U_1972_ANNUAL_AVERAGE : null;
  const base = params.isUtility ? DEFENSIVE_THRESHOLDS.minUtilityTotalAssetsUsd : DEFENSIVE_THRESHOLDS.minAnnualSalesUsd;
  const raw = params.isUtility ? last?.values.totalAssets : last?.values.revenue;
  const amountUsd =
    raw === undefined ? null : last?.currency === "USD" ? raw : params.fxToUsd ? raw * params.fxToUsd : null;
  const threshold = factor === null ? null : base * factor;
  let status: RuleStatus;
  let reason: string;
  if (factor === null) {
    status = "INSUFFICIENT_DATA";
    reason = "missingCpi";
  } else if (amountUsd === null) {
    status = "INSUFFICIENT_DATA";
    reason = raw === undefined ? (params.isUtility ? "missingTotalAssets" : "missingRevenue") : "needsFxRate";
  } else {
    status = amountUsd >= threshold! ? "PASS" : "FAIL";
    reason = "comparedInflationAdjusted";
  }
  return {
    id: "modern.inflationAdjustedSize",
    status,
    reason,
    measured: { amountUsd, inflationFactor: factor, thresholdUsd: threshold },
    thresholds: { base1973Usd: base, cpi1972: CPI_U_1972_ANNUAL_AVERAGE },
    assumptions: ["cpiUserSupplied"],
    citation: { source: "INTELLIGENT_INVESTOR_1973", chapter: 14, note: "modern adaptation of the size criterion" },
  };
}

/**
 * Bond-yield-adjusted growth formula: V = E × (8.5 + 2G) × 4.4 / Y.
 * Graham proposed the 4.4/Y scaling (4.4% being the AAA corporate yield he
 * referenced) after the 1973 edition; it is therefore a modern extension here.
 */
export function bondYieldAdjustedFormula(params: { earnings: Num; growthPercent: Num; aaaYieldPercent: Num }): ValueEstimate {
  const { earnings, growthPercent, aaaYieldPercent } = params;
  const inputs = { earnings, growthPercent, aaaYieldPercent, referenceYield: 4.4 };
  const base = { id: "modern.bondYieldAdjusted", methodology: "MODERN_EXTENSION" as const, inputs };
  if (earnings === null || growthPercent === null || aaaYieldPercent === null) {
    return { ...base, status: "INSUFFICIENT_DATA", value: null, reason: aaaYieldPercent === null ? "missingBondYield" : "missingInputs" };
  }
  if (earnings <= 0 || aaaYieldPercent <= 0) {
    return { ...base, status: "NOT_MEANINGFUL", value: null, reason: "nonPositiveInputs" };
  }
  const multiplier = 8.5 + 2 * growthPercent;
  if (multiplier <= 0) return { ...base, status: "NOT_MEANINGFUL", value: null, reason: "negativeMultiplier" };
  return {
    ...base,
    status: "OK",
    value: (earnings * multiplier * 4.4) / aaaYieldPercent,
    reason: "computed",
    assumptions: ["growthAssumption", "bondYieldUserSupplied"],
  };
}

export interface ModernMetrics {
  freeCashFlow: Num;
  freeCashFlowPerShare: Num;
  freeCashFlowYield: Num;
  earningsYield: Num;
  earningsYieldSpreadOverAaa: Num;
  returnOnEquity: Num;
  debtToEquity: Num;
  interestCoverage: Num;
}

export function modernMetrics(params: {
  annual: AnnualFinancials[];
  price: Num;
  normalEarnings: Num;
  aaaYieldPercent: Num;
}): ModernMetrics {
  const last = latest(params.annual);
  const v = last?.values ?? {};
  const fcf =
    v.operatingCashFlow !== undefined && v.capitalExpenditures !== undefined
      ? v.operatingCashFlow - Math.abs(v.capitalExpenditures)
      : null;
  const shares = v.dilutedShares ?? v.sharesOutstanding ?? null;
  const fcfps = ratio(fcf, shares);
  const ey = params.price && params.normalEarnings !== null ? params.normalEarnings / params.price : null;
  const equity = commonEquity(last);
  return {
    freeCashFlow: fcf,
    freeCashFlowPerShare: fcfps,
    freeCashFlowYield: params.price ? ratio(fcfps, params.price) : null,
    earningsYield: ey,
    earningsYieldSpreadOverAaa: ey !== null && params.aaaYieldPercent !== null ? ey - params.aaaYieldPercent / 100 : null,
    returnOnEquity: equity !== null && equity > 0 ? ratio(v.netIncome ?? null, equity) : null,
    debtToEquity: equity !== null && equity > 0 ? ratio(longTermDebt(last), equity) : null,
    interestCoverage:
      v.operatingIncome !== undefined && v.interestExpense !== undefined && v.interestExpense > 0
        ? v.operatingIncome / v.interestExpense
        : null,
  };
}
