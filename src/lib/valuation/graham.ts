/**
 * Valuation engine — Graham 1973 methods.
 *
 * Every estimate returns its formula inputs so the UI can show exactly how a
 * figure was derived. Nothing here is a recommendation.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";
import {
  averageEps,
  bookValuePerShare,
  cagr,
  eps,
  latest,
  ncavPerShare,
  sortAnnual,
  byYear,
  type Num,
} from "@/lib/graham/metrics";

export const VALUATION_ENGINE_VERSION = "1.0.0";

export type EstimateStatus = "OK" | "INSUFFICIENT_DATA" | "NOT_MEANINGFUL";

export interface ValueEstimate {
  id: string;
  methodology: "GRAHAM_1973" | "GRAHAM_DERIVED" | "MODERN_EXTENSION";
  status: EstimateStatus;
  /** Per-share intrinsic value estimate in reporting currency. */
  value: Num;
  inputs: Record<string, number | null>;
  reason: string;
  assumptions?: string[];
  chapter?: number;
}

/**
 * Normal earnings: Graham advises "normal" rather than single-year earnings;
 * we use the 3-year average diluted EPS (the same base as his P/E test).
 */
export function normalEarnings(annual: AnnualFinancials[]): Num {
  return averageEps(annual, 3);
}

/**
 * Historical per-share growth used as the *default* G assumption: CAGR between
 * the 3-year average EPS ten years ago and the latest 3-year average. Graham
 * warns that projected growth is the most uncertain input; the UI lets the
 * user override it.
 */
export function historicalEpsGrowth(annual: AnnualFinancials[], years = 10): Num {
  const s = sortAnnual(annual);
  const last = s[s.length - 1]?.fiscalYear;
  if (last === undefined) return null;
  const end = averageEps(s, 3, last);
  const start = averageEps(s, 3, last - years + 3);
  // The two 3-year windows are centred (years − 3) years apart (e.g. 7 for a 10-year span).
  return cagr(start, end, years - 3);
}

/**
 * Highest historical growth rate (percent) used as the DEFAULT G. Graham's own
 * Chapter 11 table stops at 20%, and he warns that the formula overstates value
 * for high-growth companies; extrapolating, say, 60% a year would turn a past
 * boom into an intrinsic value. Above this, no default estimate is produced
 * (NOT_MEANINGFUL); the user can still enter an explicit G.
 */
export const MAX_DEFAULT_GROWTH_PERCENT = 20;
/** Accepted range for a user-entered G (percent), matching the input field. */
export const GROWTH_OVERRIDE_RANGE = [-20, 50] as const;

/**
 * Chapter 11 (1973): Value = Current (Normal) Earnings × (8.5 + 2G), where G is
 * the expected annual growth rate (in percent) over the next seven to ten years.
 */
export function grahamGrowthFormula(params: { earnings: Num; growthPercent: Num; rejectedHistoricalGrowth?: Num }): ValueEstimate {
  const { earnings, growthPercent } = params;
  const inputs = { earnings, growthPercent, baseMultiplier: 8.5, growthMultiplier: 2 };
  if (params.rejectedHistoricalGrowth !== undefined && params.rejectedHistoricalGrowth !== null) {
    return {
      id: "graham.growthFormula",
      methodology: "GRAHAM_1973",
      status: "NOT_MEANINGFUL",
      value: null,
      inputs: { ...inputs, historicalGrowthPercent: params.rejectedHistoricalGrowth, maxDefaultGrowthPercent: MAX_DEFAULT_GROWTH_PERCENT },
      reason: "growthAboveFormulaRange",
      chapter: 11,
    };
  }
  if (earnings === null || growthPercent === null) {
    return { id: "graham.growthFormula", methodology: "GRAHAM_1973", status: "INSUFFICIENT_DATA", value: null, inputs, reason: "missingInputs", chapter: 11 };
  }
  if (earnings <= 0) {
    return { id: "graham.growthFormula", methodology: "GRAHAM_1973", status: "NOT_MEANINGFUL", value: null, inputs, reason: "nonPositiveEarnings", chapter: 11 };
  }
  const multiplier = 8.5 + 2 * growthPercent;
  if (multiplier <= 0) {
    return { id: "graham.growthFormula", methodology: "GRAHAM_1973", status: "NOT_MEANINGFUL", value: null, inputs, reason: "negativeMultiplier", chapter: 11 };
  }
  return {
    id: "graham.growthFormula",
    methodology: "GRAHAM_1973",
    status: "OK",
    value: earnings * multiplier,
    inputs: { ...inputs, multiplier },
    reason: "computed",
    assumptions: ["normalEarnings3y", "growthAssumption"],
    chapter: 11,
  };
}

/**
 * "Graham number": √(22.5 × EPS × BVPS). Not named by Graham, but algebraically
 * the maximum price satisfying his Ch. 14 defensive limits P/E ≤ 15 and
 * P/B ≤ 1.5 (15 × 1.5 = 22.5). Labelled GRAHAM_DERIVED.
 */
export function grahamNumber(params: { earnings: Num; bookValuePerShare: Num }): ValueEstimate {
  const { earnings, bookValuePerShare: bvps } = params;
  const inputs = { earnings, bookValuePerShare: bvps, factor: 22.5 };
  if (earnings === null || bvps === null) {
    return { id: "graham.number", methodology: "GRAHAM_DERIVED", status: "INSUFFICIENT_DATA", value: null, inputs, reason: "missingInputs", chapter: 14 };
  }
  if (earnings <= 0 || bvps <= 0) {
    return { id: "graham.number", methodology: "GRAHAM_DERIVED", status: "NOT_MEANINGFUL", value: null, inputs, reason: "nonPositiveInputs", chapter: 14 };
  }
  return {
    id: "graham.number",
    methodology: "GRAHAM_DERIVED",
    status: "OK",
    value: Math.sqrt(22.5 * earnings * bvps),
    inputs,
    reason: "computed",
    assumptions: ["normalEarnings3y"],
    chapter: 14,
  };
}

/**
 * Net current asset value per share (Ch. 15 "bargain issues"): current assets
 * less all liabilities and preferred stock. Graham bought such issues at or
 * below two-thirds of this figure; we report both.
 */
export function netNetValue(a: AnnualFinancials | null): ValueEstimate {
  const v = ncavPerShare(a);
  const inputs = { ncavPerShare: v, twoThirds: v === null ? null : (v * 2) / 3 };
  if (v === null) return { id: "graham.ncav", methodology: "GRAHAM_1973", status: "INSUFFICIENT_DATA", value: null, inputs, reason: "missingInputs", chapter: 15 };
  if (v <= 0) return { id: "graham.ncav", methodology: "GRAHAM_1973", status: "NOT_MEANINGFUL", value: v, inputs, reason: "negativeNcav", chapter: 15 };
  return { id: "graham.ncav", methodology: "GRAHAM_1973", status: "OK", value: v, inputs, reason: "computed", chapter: 15 };
}

/** Margin of safety = (value − price) / value. Positive: price below the estimate. */
export function marginOfSafety(value: Num, price: Num): Num {
  if (value === null || price === null || value <= 0) return null;
  return (value - price) / value;
}

export interface GrahamValuation {
  engineVersion: string;
  normalEarnings: Num;
  latestEps: Num;
  bookValuePerShare: Num;
  historicalGrowth: Num;
  growthPercentUsed: Num;
  growthSource: "HISTORICAL" | "USER" | "NONE";
  /** Historical growth (percent) that was too high to use as the default G; null otherwise. */
  rejectedHistoricalGrowth: Num;
  estimates: ValueEstimate[];
  price: Num;
  marginsOfSafety: Record<string, Num>;
}

export function valueWithGraham(params: {
  annual: AnnualFinancials[];
  price: Num;
  /** User override for G, in percent (e.g. 5 for 5%). */
  growthPercentOverride?: number | null;
}): GrahamValuation {
  const { annual, price } = params;
  const last = latest(annual);
  const ne = normalEarnings(annual);
  const bvps = bookValuePerShare(last);
  const hist = historicalEpsGrowth(annual);
  const raw = params.growthPercentOverride;
  const override =
    raw !== undefined && raw !== null && Number.isFinite(raw) && raw >= GROWTH_OVERRIDE_RANGE[0] && raw <= GROWTH_OVERRIDE_RANGE[1] ? raw : null;
  const histPercent = hist !== null ? hist * 100 : null;
  const rejectedHistoricalGrowth = override === null && histPercent !== null && histPercent > MAX_DEFAULT_GROWTH_PERCENT ? histPercent : null;
  const growthPercentUsed = override !== null ? override : rejectedHistoricalGrowth === null ? histPercent : null;
  const growthSource = override !== null ? "USER" : growthPercentUsed !== null ? "HISTORICAL" : "NONE";

  const estimates = [
    grahamGrowthFormula({ earnings: ne, growthPercent: growthPercentUsed, rejectedHistoricalGrowth }),
    grahamNumber({ earnings: ne, bookValuePerShare: bvps }),
    netNetValue(last),
  ];
  const marginsOfSafety = Object.fromEntries(
    estimates.map((e) => [e.id, e.status === "OK" ? marginOfSafety(e.value, price) : null]),
  );
  const map = byYear(annual);
  return {
    engineVersion: VALUATION_ENGINE_VERSION,
    normalEarnings: ne,
    latestEps: last ? eps(map.get(last.fiscalYear)) : null,
    bookValuePerShare: bvps,
    historicalGrowth: hist,
    growthPercentUsed,
    growthSource,
    rejectedHistoricalGrowth,
    estimates,
    price,
    marginsOfSafety,
  };
}
