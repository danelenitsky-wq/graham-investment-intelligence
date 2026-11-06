/**
 * BOTTOM-LINE FAIR VALUE — a plain-language summary of the valuation models.
 *
 * Answers two questions for a non-expert reader:
 *   1. What is the stock worth according to the models that fit this company
 *      (a low / base / high range in the statements' currency)?
 *   2. How far is the market price from that estimate (the % gap)?
 *
 * Which models count (deterministic, no price input in the choice):
 *  - DCF intrinsic value (MODERN EXTENSION, src/lib/valuation/intrinsic.ts),
 *    with its sensitivity grid as the scenarios.
 *  - Graham's Chapter 11 growth formula E × (8.5 + 2G) (GRAHAM 1973), only
 *    when G is inside the formula's range (the valuation engine already
 *    refuses a default G above 20%). Scenarios: G − 2pp, G, G + 2pp.
 *  - NCAV per share (asset value) ONLY as a fallback when neither earnings
 *    model is available, e.g. a loss-making company with net current assets.
 *
 * Deliberately NOT counted, and listed as such:
 *  - the Graham Number and the defensive / enterprising ceilings: screening
 *    limits (the highest price a rule allows), not estimates of value;
 *  - the Net-Net ⅔ × NCAV purchase threshold: a bargain-hunting entry point
 *    for asset-rich companies, far below the value of a profitable business.
 *
 * Blend: base = equal-weight average of the counted models' base values;
 * range = lowest low to highest high. The "scenarios above price" count is the
 * share of computed scenarios whose value exceeds the price. It describes the
 * spread of the model inputs, it is NOT a probability or a forecast.
 *
 * "Implied growth" reverses the DCF: the yearly revenue growth (all other
 * assumptions unchanged) at which the DCF value equals the market price. It
 * explains a large gap in one sentence (what the price is betting on).
 *
 * Pure and dependency-free. Nothing here is a recommendation.
 */
import type { GrahamValuation } from "./graham";
import { dcfValue, type IntrinsicAssumptions, type IntrinsicResult } from "./intrinsic";

type Num = number | null;

export const FAIR_VALUE_VERSION = "1.0.0";

/** Price within ±10% of the base estimate reads as "close to the estimate". */
export const FAIR_BAND = 0.1;
/** When the counted models' base values differ by more than this factor, they are flagged as disagreeing. */
export const DISAGREEMENT_FACTOR = 2;
/** Search range for the implied revenue growth (decimal). */
export const IMPLIED_GROWTH_RANGE = [-0.3, 0.6] as const;
/** Step either side of G (percentage points) for the growth-formula scenarios. */
export const GROWTH_FORMULA_STEP = 2;

export type FairValueModelId = "dcf" | "grahamFormula" | "ncav" | "grahamNumber" | "netNetThreshold";

export type FairValueModelRole = "USED" | "NOT_AVAILABLE" | "NOT_A_VALUE" | "FALLBACK_ONLY";

export interface FairValueModel {
  id: FairValueModelId;
  methodology: "GRAHAM_1973" | "GRAHAM_DERIVED" | "MODERN_EXTENSION";
  role: FairValueModelRole;
  /** Machine reason (i18n key) for the role. */
  reason: string;
  value: Num;
  low: Num;
  high: Num;
}

export type FairValueVerdict = "BELOW_ESTIMATE" | "NEAR_ESTIMATE" | "ABOVE_ESTIMATE";

export interface FairValueSummary {
  version: string;
  status: "ESTABLISHED" | "NOT_ESTABLISHED";
  reason: "computed" | "noModel";
  currency: string | null;
  /** Comparable market price (statements' currency); null when not comparable. */
  price: Num;
  base: Num;
  low: Num;
  high: Num;
  /** (base − price) / price. Positive: the estimate is above the price. */
  gap: Num;
  gapLow: Num;
  gapHigh: Num;
  verdict: FairValueVerdict | null;
  models: FairValueModel[];
  scenarios: { values: number[]; above: number; total: number };
  impliedGrowth: {
    /** Yearly revenue growth (decimal) at which the DCF equals the price; null when not computable. */
    value: Num;
    /** The price needs more (or less) growth than the search range covers. */
    outOfRange: "ABOVE" | "BELOW" | null;
    assumed: Num;
    historical: Num;
    years: number | null;
  };
  flags: { modelsDisagree: boolean; terminalHeavy: boolean; assetBasedOnly: boolean; cashFlowBelowEarnings: boolean };
}

export interface FairValueInput {
  intrinsic: IntrinsicResult;
  graham: GrahamValuation;
  ncavPerShare: Num;
  /** Graham Number and the Net-Net threshold, only to list them as "not a value". */
  grahamNumber: Num;
  netNetThreshold: Num;
  price: Num;
  currency: string | null;
  historicalRevenueGrowth: Num;
  /** Normalized FCF margin far below the net-income margin (from the DCF defaults). */
  fcfWellBelowEarnings?: boolean;
}

const positive = (v: Num | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v) && v > 0;

/** Graham Ch. 11 value for a G in percent; null when not meaningful. */
function growthFormulaValue(earnings: number, g: number): Num {
  const m = 8.5 + 2 * g;
  return m > 0 ? earnings * m : null;
}

/**
 * Revenue growth at which the DCF value equals `price` (bisection; the DCF is
 * increasing in revenue growth when the margin is positive).
 */
export function impliedRevenueGrowth(baseRevenue: number, baseShares: number, a: IntrinsicAssumptions, price: number): { value: Num; outOfRange: "ABOVE" | "BELOW" | null } {
  const at = (g: number) => dcfValue(baseRevenue, baseShares, { ...a, revenueGrowth: g }).value;
  let [lo, hi] = IMPLIED_GROWTH_RANGE as unknown as [number, number];
  const vLo = at(lo);
  const vHi = at(hi);
  if (vHi === null || vLo === null) return { value: null, outOfRange: null };
  if (price > vHi) return { value: null, outOfRange: "ABOVE" };
  if (price < vLo) return { value: null, outOfRange: "BELOW" };
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = at(mid);
    if (v === null) return { value: null, outOfRange: null };
    if (v < price) lo = mid;
    else hi = mid;
  }
  return { value: (lo + hi) / 2, outOfRange: null };
}

export function buildFairValue(input: FairValueInput): FairValueSummary {
  const { intrinsic: iv, graham } = input;
  const price = positive(input.price) ? input.price : null;
  const models: FairValueModel[] = [];
  const scenarioValues: number[] = [];

  // 1. DCF intrinsic value (modern extension).
  if (iv.status === "ESTABLISHED" && positive(iv.value)) {
    models.push({ id: "dcf", methodology: "MODERN_EXTENSION", role: "USED", reason: "computed", value: iv.value, low: iv.low ?? iv.value, high: iv.high ?? iv.value });
    for (const row of iv.sensitivity?.values ?? []) for (const v of row) if (positive(v)) scenarioValues.push(v);
    if (!iv.sensitivity) scenarioValues.push(iv.value);
  } else {
    models.push({ id: "dcf", methodology: "MODERN_EXTENSION", role: "NOT_AVAILABLE", reason: iv.status === "DISABLED" ? "disabled" : iv.reason, value: null, low: null, high: null });
  }

  // 2. Graham growth formula (1973), only with an accepted G.
  const gf = graham.estimates.find((e) => e.id === "graham.growthFormula");
  const e = graham.normalEarnings;
  const g = graham.growthPercentUsed;
  if (gf?.status === "OK" && positive(gf.value) && positive(e) && g !== null) {
    const variants = [g - GROWTH_FORMULA_STEP, g, g + GROWTH_FORMULA_STEP].map((x) => growthFormulaValue(e, x)).filter(positive);
    models.push({ id: "grahamFormula", methodology: "GRAHAM_1973", role: "USED", reason: graham.growthSource === "USER" ? "userGrowth" : "computed", value: gf.value, low: Math.min(...variants), high: Math.max(...variants) });
    scenarioValues.push(...variants);
  } else {
    models.push({ id: "grahamFormula", methodology: "GRAHAM_1973", role: "NOT_AVAILABLE", reason: gf?.reason ?? "missingInputs", value: null, low: null, high: null });
  }

  const earningsModels = models.filter((m) => m.role === "USED");

  // 3. NCAV: asset value, counted only when no earnings model is available.
  const ncav = input.ncavPerShare;
  if (earningsModels.length === 0 && positive(ncav)) {
    const low = (ncav * 2) / 3;
    models.push({ id: "ncav", methodology: "GRAHAM_1973", role: "USED", reason: "assetFallback", value: ncav, low, high: ncav });
    scenarioValues.push(low, ncav);
  } else {
    models.push({ id: "ncav", methodology: "GRAHAM_1973", role: positive(ncav) ? "FALLBACK_ONLY" : "NOT_AVAILABLE", reason: positive(ncav) ? "earningsModelsPreferred" : "nonPositiveNcav", value: positive(ncav) ? ncav : null, low: null, high: null });
  }

  // Screening limits: listed so the reader knows why they are not "the value".
  models.push({ id: "grahamNumber", methodology: "GRAHAM_DERIVED", role: "NOT_A_VALUE", reason: "screeningLimit", value: input.grahamNumber, low: null, high: null });
  models.push({ id: "netNetThreshold", methodology: "GRAHAM_1973", role: "NOT_A_VALUE", reason: "bargainThreshold", value: input.netNetThreshold, low: null, high: null });

  const used = models.filter((m) => m.role === "USED");
  const historical = input.historicalRevenueGrowth;
  const noImplied = { value: null, outOfRange: null, assumed: iv.status === "ESTABLISHED" ? iv.assumptions.revenueGrowth : null, historical, years: iv.status === "ESTABLISHED" ? iv.assumptions.projectionYears : null };

  if (used.length === 0) {
    return {
      version: FAIR_VALUE_VERSION,
      status: "NOT_ESTABLISHED",
      reason: "noModel",
      currency: input.currency,
      price,
      base: null,
      low: null,
      high: null,
      gap: null,
      gapLow: null,
      gapHigh: null,
      verdict: null,
      models,
      scenarios: { values: [], above: 0, total: 0 },
      impliedGrowth: noImplied,
      flags: { modelsDisagree: false, terminalHeavy: false, assetBasedOnly: false, cashFlowBelowEarnings: false },
    };
  }

  const base = used.reduce((s, m) => s + m.value!, 0) / used.length;
  const low = Math.min(...used.map((m) => m.low ?? m.value!));
  const high = Math.max(...used.map((m) => m.high ?? m.value!));
  const bases = used.map((m) => m.value!);
  const gapOf = (v: number) => (price === null ? null : (v - price) / price);
  const gap = gapOf(base);
  const verdict: FairValueVerdict | null = gap === null ? null : gap > FAIR_BAND ? "BELOW_ESTIMATE" : gap < -FAIR_BAND ? "ABOVE_ESTIMATE" : "NEAR_ESTIMATE";

  let impliedGrowth = noImplied as FairValueSummary["impliedGrowth"];
  if (price !== null && iv.status === "ESTABLISHED" && positive(iv.inputs.baseRevenue) && positive(iv.inputs.baseShares) && iv.method === "DCF") {
    impliedGrowth = { ...noImplied, ...impliedRevenueGrowth(iv.inputs.baseRevenue, iv.inputs.baseShares, iv.assumptions, price) };
  }

  return {
    version: FAIR_VALUE_VERSION,
    status: "ESTABLISHED",
    reason: "computed",
    currency: input.currency,
    price,
    base,
    low,
    high,
    gap,
    gapLow: gapOf(low),
    gapHigh: gapOf(high),
    verdict,
    models,
    scenarios: {
      values: [...scenarioValues].sort((a, b) => a - b),
      above: price === null ? 0 : scenarioValues.filter((v) => v > price).length,
      total: price === null ? 0 : scenarioValues.length,
    },
    impliedGrowth,
    flags: {
      modelsDisagree: bases.length > 1 && Math.max(...bases) / Math.min(...bases) > DISAGREEMENT_FACTOR,
      terminalHeavy: used.some((m) => m.id === "dcf") && iv.terminalHeavy,
      assetBasedOnly: used.length === 1 && used[0].id === "ncav",
      cashFlowBelowEarnings: used.some((m) => m.id === "dcf") && input.fcfWellBelowEarnings === true,
    },
  };
}
