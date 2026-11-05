/**
 * Transparent valuation engine: Graham price ceilings, the Graham Number,
 * the Net-Net threshold, an optional conservative intrinsic value, and the
 * margin of safety.
 *
 * Price ceilings are the HIGHEST price at which the stock would still satisfy
 * the price-dependent Graham rules. They are screening limits, NOT estimates
 * of intrinsic value; in particular the Graham Number is never used as
 * intrinsic value. Every ceiling reads the same inputs the Graham rules engine
 * used (3-year average EPS, book value, tangible book value, NCAV per share),
 * so the dashboard and the rule panels can never disagree.
 *
 * When an input is missing or non-positive, the ceiling is NOT_ESTABLISHED
 * and no price target is fabricated.
 */
import type { GrahamAnalysis } from "@/lib/graham";
import { DEFENSIVE_THRESHOLDS, ENTERPRISING_THRESHOLDS, findRule, ruleValue } from "@/lib/graham/rules";
import { NET_NET_THRESHOLDS } from "@/lib/graham/netnet";
import type { RuleResult, RuleStatus, ScreenResult, VerificationLevel } from "@/lib/graham/types";
import type { QuoteStatus } from "@/lib/freshness/quote";
import type { IntrinsicResult } from "./intrinsic";

type Num = number | null;

export const VALUATION_DASHBOARD_VERSION = "1.0.0";

/** Application assumption (NOT a universal Graham rule): default margin-of-safety target. */
export const DEFAULT_MARGIN_OF_SAFETY_TARGET = 0.3;

// ─────────────────────────────── price context ───────────────────────────────

export type PriceBasis = "CURRENT" | "HISTORICAL" | "UNAVAILABLE";

export interface PriceInfo {
  value: number;
  currency: string;
  /** Trading date of the price (exchange-local, YYYY-MM-DD). */
  date: string;
  /** Provider timestamp (ISO instant) when known. */
  timestamp: string | null;
  source: string | null;
  /** Quote freshness status; null for a stored daily close used as a fallback. */
  quoteStatus: QuoteStatus | null;
}

export interface PriceContext {
  basis: PriceBasis;
  price: PriceInfo | null;
  /** Price in the statements' currency; null when missing or in another currency. */
  comparable: Num;
  /** Why the comparison is limited, if it is. */
  warning: "noPrice" | "staleQuote" | "storedCloseFallback" | "agedPrice" | "conflictedQuote" | "currencyMismatch" | null;
  ageDays: number | null;
}

const CURRENT_STATUSES: QuoteStatus[] = ["FRESH", "DELAYED", "LAST_CLOSE", "CACHED"];

/**
 * Classify the price used for comparisons. Anything other than a current
 * quote (stale, conflicted, older than `staleAfterDays`, or a stored close
 * used because no quote exists) is HISTORICAL and labelled as such.
 */
export function resolvePriceContext(params: {
  quote: PriceInfo | null;
  /** Latest stored daily close, used only when there is no quote. */
  storedClose?: { value: number; date: string; currency: string; source: string | null } | null;
  statementCurrency: string | null;
  today: string;
  staleAfterDays: number;
}): PriceContext {
  const { quote, storedClose, statementCurrency, today, staleAfterDays } = params;
  let price: PriceInfo | null = quote;
  let warning: PriceContext["warning"] = null;
  let basis: PriceBasis = "CURRENT";
  if (!price && storedClose) {
    price = { ...storedClose, timestamp: null, quoteStatus: null };
    basis = "HISTORICAL";
    warning = "storedCloseFallback";
  }
  if (!price) return { basis: "UNAVAILABLE", price: null, comparable: null, warning: "noPrice", ageDays: null };
  const ageDays = Math.max(0, Math.round((Date.parse(today) - Date.parse(price.date)) / 86_400_000));
  if (price.quoteStatus === "CONFLICTED") {
    basis = "HISTORICAL";
    warning = "conflictedQuote";
  } else if (price.quoteStatus !== null && !CURRENT_STATUSES.includes(price.quoteStatus)) {
    basis = "HISTORICAL";
    warning = "staleQuote";
  }
  if (basis === "CURRENT" && Number.isFinite(ageDays) && ageDays > staleAfterDays) {
    basis = "HISTORICAL";
    warning = "agedPrice";
  }
  const sameCurrency = statementCurrency !== null && price.currency === statementCurrency;
  if (!sameCurrency) warning = "currencyMismatch";
  return { basis, price, comparable: sameCurrency ? price.value : null, warning, ageDays: Number.isFinite(ageDays) ? ageDays : null };
}

// ─────────────────────────────── ceilings ───────────────────────────────

export type CeilingStatus = "ESTABLISHED" | "NOT_ESTABLISHED" | "NOT_APPLICABLE";

export type CeilingReason =
  | "computed"
  | "missingEarnings"
  | "missingBookValue"
  | "missingTangibleBook"
  | "missingNcav"
  | "nonPositiveEarnings"
  | "nonPositiveBookValue"
  | "nonPositiveTangibleBook"
  | "nonPositiveNcav"
  | "notApplicable";

export interface CeilingComponent {
  /** Stable key (i18n). */
  key: string;
  /** Graham rule this limit comes from. */
  ruleId: string;
  formula: string;
  value: Num;
  verification: VerificationLevel;
  /** The rule requires price strictly below the limit (E7: "< 120%"). */
  strict: boolean;
}

export interface PriceCeiling {
  id: "grahamNumber" | "defensive" | "enterprising" | "netNet";
  status: CeilingStatus;
  reason: CeilingReason;
  value: Num;
  formula: string;
  components: CeilingComponent[];
  /** Component key that sets the ceiling (the lowest applicable limit). */
  binding: string | null;
  /** UNVERIFIED if any component the ceiling depends on is UNVERIFIED. */
  verification: VerificationLevel;
  strict: boolean;
  inputs: Record<string, Num>;
}

export interface PriceComparison {
  /** (threshold − price) / price: the move needed for the price to reach the threshold (negative = must fall). */
  changeRequired: Num;
  /** Price is at or below the threshold (strictly below for strict limits); null when not comparable. */
  withinThreshold: boolean | null;
}

const worst = (levels: VerificationLevel[]): VerificationLevel =>
  levels.includes("UNVERIFIED") ? "UNVERIFIED" : levels.includes("VERIFIED_SECONDARY") ? "VERIFIED_SECONDARY" : "NOT_A_GRAHAM_RULE";

const verificationOf = (rule: RuleResult | undefined, fallback: VerificationLevel): VerificationLevel => rule?.verification ?? fallback;

/**
 * Graham Number √(22.5 × EPS₃ × BVPS): the price at which P/E₃ × P/B = 22.5.
 * A derived figure. It does not establish defensive qualification (P/E ≤ 15
 * remains a separate condition) and it is not intrinsic value.
 */
export function grahamNumberCeiling(p: { averageEps: Num; bookValuePerShare: Num }): PriceCeiling {
  const { averageEps: e, bookValuePerShare: b } = p;
  const formula = "√(22.5 × avgEPS₃ × BVPS)";
  const shell: PriceCeiling = {
    id: "grahamNumber",
    status: "NOT_ESTABLISHED",
    reason: "computed",
    value: null,
    formula,
    components: [],
    binding: null,
    verification: "NOT_A_GRAHAM_RULE",
    strict: false,
    inputs: { averageEps3y: e, bookValuePerShare: b, factor: DEFENSIVE_THRESHOLDS.maxPeTimesPb },
  };
  if (e === null) return { ...shell, reason: "missingEarnings" };
  if (b === null) return { ...shell, reason: "missingBookValue" };
  if (e <= 0) return { ...shell, reason: "nonPositiveEarnings" };
  if (b <= 0) return { ...shell, reason: "nonPositiveBookValue" };
  return { ...shell, status: "ESTABLISHED", value: Math.sqrt(DEFENSIVE_THRESHOLDS.maxPeTimesPb * e * b) };
}

/**
 * Defensive qualifying price ceiling (Ch. 14, D6 and D7):
 *   D6: P ≤ 15 × avgEPS₃
 *   D7: P ≤ 1.5 × BVPS  OR  P ≤ √(22.5 × avgEPS₃ × BVPS)
 *   ceiling = min(D6, max(1.5 × BVPS, Graham Number))
 * Both rules must hold, so the Graham Number alone never qualifies a price.
 */
export function defensiveCeiling(p: { averageEps: Num; bookValuePerShare: Num; verification?: { D6?: VerificationLevel; D7?: VerificationLevel } }): PriceCeiling {
  const { averageEps: e, bookValuePerShare: b } = p;
  const T = DEFENSIVE_THRESHOLDS;
  const vD6 = p.verification?.D6 ?? "VERIFIED_SECONDARY";
  const vD7 = p.verification?.D7 ?? "VERIFIED_SECONDARY";
  const gn = grahamNumberCeiling({ averageEps: e, bookValuePerShare: b });
  const peLimit = e !== null && e > 0 ? T.maxPeOnThreeYearAverage * e : null;
  const pbLimit = b !== null && b > 0 ? T.maxPriceToBook * b : null;
  const components: CeilingComponent[] = [
    { key: "peLimit", ruleId: "D6", formula: "15 × avgEPS₃", value: peLimit, verification: vD6, strict: false },
    { key: "pbLimit", ruleId: "D7", formula: "1.5 × BVPS", value: pbLimit, verification: vD7, strict: false },
    { key: "grahamNumber", ruleId: "D7", formula: "√(22.5 × avgEPS₃ × BVPS)", value: gn.value, verification: vD7, strict: false },
  ];
  const shell: PriceCeiling = {
    id: "defensive",
    status: "NOT_ESTABLISHED",
    reason: "computed",
    value: null,
    formula: "min(15 × avgEPS₃, max(1.5 × BVPS, √(22.5 × avgEPS₃ × BVPS)))",
    components,
    binding: null,
    verification: worst([vD6, vD7]),
    strict: false,
    inputs: { averageEps3y: e, bookValuePerShare: b },
  };
  if (e === null) return { ...shell, reason: "missingEarnings" };
  if (e <= 0) return { ...shell, reason: "nonPositiveEarnings" };
  if (b === null) return { ...shell, reason: "missingBookValue" };
  if (b <= 0) return { ...shell, reason: "nonPositiveBookValue" };
  const d7 = Math.max(pbLimit!, gn.value!);
  const value = Math.min(peLimit!, d7);
  const binding = value === peLimit ? "peLimit" : d7 === gn.value ? "grahamNumber" : "pbLimit";
  return { ...shell, status: "ESTABLISHED", value, binding };
}

/**
 * Enterprising qualifying price ceiling (Ch. 15):
 *   E6 (earnings, UNVERIFIED definition): P ≤ 1.2 × 9 × avgEPS₃ = 10.8 × avgEPS₃
 *   E7 (tangible assets):                 P < 1.2 × NTAPS
 *   ceiling = min(E6, E7). The E6 flag is carried onto the ceiling.
 */
export function enterprisingCeiling(p: { averageEps: Num; tangibleBookValuePerShare: Num; verification?: { E6?: VerificationLevel; E7?: VerificationLevel } }): PriceCeiling {
  const { averageEps: e, tangibleBookValuePerShare: t } = p;
  const T = ENTERPRISING_THRESHOLDS;
  const vE6 = p.verification?.E6 ?? "UNVERIFIED";
  const vE7 = p.verification?.E7 ?? "VERIFIED_SECONDARY";
  const earningsLimit = e !== null && e > 0 ? T.maxPriceToEarningsValue * T.earningsMultiplier * e : null;
  const tangibleLimit = t !== null && t > 0 ? T.maxPriceToNetTangibleAssets * t : null;
  const components: CeilingComponent[] = [
    { key: "earningsLimit", ruleId: "E6", formula: "1.2 × 9 × avgEPS₃", value: earningsLimit, verification: vE6, strict: false },
    { key: "tangibleLimit", ruleId: "E7", formula: "1.2 × NTAPS", value: tangibleLimit, verification: vE7, strict: true },
  ];
  const shell: PriceCeiling = {
    id: "enterprising",
    status: "NOT_ESTABLISHED",
    reason: "computed",
    value: null,
    formula: "min(10.8 × avgEPS₃, 1.2 × NTAPS)",
    components,
    binding: null,
    verification: worst([vE6, vE7]),
    strict: false,
    inputs: { averageEps3y: e, tangibleBookValuePerShare: t },
  };
  if (e === null) return { ...shell, reason: "missingEarnings" };
  if (e <= 0) return { ...shell, reason: "nonPositiveEarnings" };
  if (t === null) return { ...shell, reason: "missingTangibleBook" };
  if (t <= 0) return { ...shell, reason: "nonPositiveTangibleBook" };
  const tangibleBinds = tangibleLimit! <= earningsLimit!;
  return {
    ...shell,
    status: "ESTABLISHED",
    value: Math.min(earningsLimit!, tangibleLimit!),
    binding: tangibleBinds ? "tangibleLimit" : "earningsLimit",
    strict: tangibleBinds,
  };
}

/** Net-Net: NCAV per share and the two-thirds purchase threshold (factor UNVERIFIED). */
export function netNetCeiling(p: { ncavPerShare: Num; verification?: VerificationLevel }): PriceCeiling {
  const n = p.ncavPerShare;
  const v = p.verification ?? "UNVERIFIED";
  const threshold = n !== null && n > 0 ? NET_NET_THRESHOLDS.purchaseFraction * n : null;
  const shell: PriceCeiling = {
    id: "netNet",
    status: "NOT_ESTABLISHED",
    reason: "computed",
    value: null,
    formula: "2/3 × (CA − TL) / Shares",
    components: [{ key: "twoThirdsNcav", ruleId: "NN1", formula: "2/3 × NCAV/share", value: threshold, verification: v, strict: false }],
    binding: null,
    verification: v,
    strict: false,
    inputs: { ncavPerShare: n, purchaseFraction: NET_NET_THRESHOLDS.purchaseFraction },
  };
  if (n === null) return { ...shell, reason: "missingNcav" };
  if (n <= 0) return { ...shell, reason: "nonPositiveNcav" };
  return { ...shell, status: "ESTABLISHED", value: threshold, binding: "twoThirdsNcav" };
}

export function compareToPrice(threshold: Num, price: Num, strict = false): PriceComparison {
  if (threshold === null || price === null || price <= 0) return { changeRequired: null, withinThreshold: null };
  return { changeRequired: (threshold - price) / price, withinThreshold: strict ? price < threshold : price <= threshold };
}

// ─────────────────────────────── margin of safety ───────────────────────────────

export type MarginOfSafetyStatus = "ESTABLISHED" | "NOT_ESTABLISHED";

export interface MarginOfSafety {
  status: MarginOfSafetyStatus;
  /** Why it is not established. */
  reason: "computed" | "noIntrinsicValue" | "noComparablePrice";
  /** (IV − P) / IV × 100, in percent. */
  percent: Num;
  /** Target, as a fraction (0.30 = 30%). */
  target: number;
  /** Highest price meeting the target: IV × (1 − target). */
  targetPrice: Num;
  meetsTarget: boolean | null;
  /** (targetPrice − P) / P */
  changeRequired: Num;
}

/** Margin of Safety = (Intrinsic Value − Market Price) / Intrinsic Value × 100. */
export function marginOfSafetyPercent(intrinsicValue: Num, price: Num): Num {
  if (intrinsicValue === null || price === null || !(intrinsicValue > 0) || !(price > 0)) return null;
  return ((intrinsicValue - price) / intrinsicValue) * 100;
}

export function marginOfSafety(intrinsic: IntrinsicResult | null, price: Num, target = DEFAULT_MARGIN_OF_SAFETY_TARGET): MarginOfSafety {
  const t = Math.min(0.95, Math.max(0, target));
  if (!intrinsic || intrinsic.status !== "ESTABLISHED" || intrinsic.value === null) {
    return { status: "NOT_ESTABLISHED", reason: "noIntrinsicValue", percent: null, target: t, targetPrice: null, meetsTarget: null, changeRequired: null };
  }
  const targetPrice = intrinsic.value * (1 - t);
  if (price === null) return { status: "NOT_ESTABLISHED", reason: "noComparablePrice", percent: null, target: t, targetPrice, meetsTarget: null, changeRequired: null };
  const percent = marginOfSafetyPercent(intrinsic.value, price);
  return {
    status: "ESTABLISHED",
    reason: "computed",
    percent,
    target: t,
    targetPrice,
    meetsTarget: percent === null ? null : percent >= t * 100,
    changeRequired: compareToPrice(targetPrice, price).changeRequired,
  };
}

// ─────────────────────────────── dashboard ───────────────────────────────

export interface NonPriceCriteria {
  passed: number;
  failed: number;
  insufficient: number;
  /** Rule ids that are not price-dependent but fail or lack data. */
  open: { id: string; status: RuleStatus }[];
}

export interface CeilingRow {
  ceiling: PriceCeiling;
  comparison: PriceComparison;
  /** For defensive/enterprising: the non-price criteria of the screen (a ceiling alone never qualifies a stock). */
  otherCriteria: NonPriceCriteria | null;
}

export interface ValuationDashboard {
  version: string;
  price: PriceContext;
  currency: string | null;
  grahamNumber: CeilingRow;
  defensive: CeilingRow;
  enterprising: CeilingRow;
  netNet: CeilingRow & { ncavPerShare: Num };
}

const PRICE_RULES = new Set(["D6", "D7", "E6", "E7", "NN1"]);

function nonPriceCriteria(screen: ScreenResult): NonPriceCriteria {
  const rules = screen.rules.filter((r) => r.counted && !PRICE_RULES.has(r.id) && r.status !== "NOT_APPLICABLE");
  return {
    passed: rules.filter((r) => r.status === "PASS").length,
    failed: rules.filter((r) => r.status === "FAIL").length,
    insufficient: rules.filter((r) => r.status === "INSUFFICIENT_DATA").length,
    open: rules.filter((r) => r.status !== "PASS").map((r) => ({ id: r.id, status: r.status })),
  };
}

function notApplicable(c: PriceCeiling): PriceCeiling {
  return { ...c, status: "NOT_APPLICABLE", reason: "notApplicable", value: null, binding: null, components: c.components.map((x) => ({ ...x, value: null })) };
}

/** Build every price ceiling from the Graham engine's own inputs and compare it to the price. */
export function buildValuationDashboard(params: { graham: GrahamAnalysis; price: PriceContext; currency: string | null }): ValuationDashboard {
  const { graham, price } = params;
  const D6 = findRule(graham.defensive, "D6");
  const D7 = findRule(graham.defensive, "D7");
  const E6 = findRule(graham.enterprising, "E6");
  const E7 = findRule(graham.enterprising, "E7");
  const NN1 = findRule(graham.netNet.screen, "NN1");

  const avgEpsDef = ruleValue(D6, "averageEps3y");
  const bvps = ruleValue(D7, "bookValuePerShare");
  const avgEpsEnt = ruleValue(E6, "averageEps3y");
  const tbvps = ruleValue(E7, "tangibleBookValuePerShare");

  let gn = grahamNumberCeiling({ averageEps: avgEpsDef, bookValuePerShare: bvps });
  let def = defensiveCeiling({ averageEps: avgEpsDef, bookValuePerShare: bvps, verification: { D6: verificationOf(D6, "VERIFIED_SECONDARY"), D7: verificationOf(D7, "VERIFIED_SECONDARY") } });
  let ent = enterprisingCeiling({ averageEps: avgEpsEnt, tangibleBookValuePerShare: tbvps, verification: { E6: verificationOf(E6, "UNVERIFIED"), E7: verificationOf(E7, "VERIFIED_SECONDARY") } });
  let nn = netNetCeiling({ ncavPerShare: graham.netNet.ncavPerShare, verification: verificationOf(NN1, "UNVERIFIED") });

  if (D6?.status === "NOT_APPLICABLE" || D7?.status === "NOT_APPLICABLE") {
    def = notApplicable(def);
    gn = notApplicable(gn);
  }
  if (E6?.status === "NOT_APPLICABLE" || E7?.status === "NOT_APPLICABLE") ent = notApplicable(ent);
  if (NN1?.status === "NOT_APPLICABLE") nn = notApplicable(nn);

  const row = (c: PriceCeiling, screen: ScreenResult | null): CeilingRow => ({
    ceiling: c,
    comparison: compareToPrice(c.value, price.comparable, c.strict),
    otherCriteria: screen && c.status !== "NOT_APPLICABLE" ? nonPriceCriteria(screen) : null,
  });

  return {
    version: VALUATION_DASHBOARD_VERSION,
    price,
    currency: params.currency,
    grahamNumber: row(gn, null),
    defensive: row(def, graham.defensive),
    enterprising: row(ent, graham.enterprising),
    netNet: { ...row(nn, null), ncavPerShare: graham.netNet.ncavPerShare },
  };
}
