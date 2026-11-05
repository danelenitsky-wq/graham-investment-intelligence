/**
 * Explainable investment decision-support engine (pure, deterministic).
 *
 * Reads the outputs of the Graham rules engine, the valuation dashboard, the
 * optional intrinsic-value model, the data-sufficiency gate and the portfolio
 * position, and assigns ONE application-defined research classification:
 *
 *   BUY CANDIDATE · HOLD · WAIT · REVIEW FOR SALE · AVOID · INSUFFICIENT VERIFIED DATA
 *
 * These are research classifications defined by this application, not
 * mechanical trading instructions from Benjamin Graham. No figure is computed
 * here that is not already a deterministic output of an upstream engine
 * (except simple ratios of those outputs, e.g. price ÷ ceiling), and no
 * intrinsic value is ever filled in when the model did not establish one.
 *
 * Guarantees (each covered by unit tests):
 *  - A price fall is never, by itself, a reason to review a position for sale:
 *    no rule here compares the price with the purchase cost.
 *  - Failing Graham's price/earnings and price/book limits leads to WAIT, not
 *    AVOID: those are price tests, not judgments on the business.
 *  - Missing, stale, conflicting or fixture data yields INSUFFICIENT VERIFIED
 *    DATA, before any other category (an owned position is not flagged for
 *    sale on unreliable data either).
 *  - BUY CANDIDATE is only produced when the data gate passes; qualifications
 *    that remain (unverified rule wording, single-source figures, no
 *    intrinsic value) lower the confidence to LOW and are listed.
 */
import { findRule } from "@/lib/graham/rules";
import type { RuleResult, ScreenResult } from "@/lib/graham/types";
import type { RiskIndicator } from "@/lib/graham/netnet";
import type { CeilingRow } from "@/lib/valuation/engine";
import type {
  CodedStatement,
  DecisionCategory,
  DecisionInputs,
  DecisionResult,
  Evidence,
  FactorAssessment,
  FactorId,
  FactorStatus,
  KeyFigures,
  Strategy,
} from "./types";

export const DECISION_ENGINE_VERSION = "1.0.0";

/** Rules whose outcome depends on the market price (Graham's valuation limits). */
export const PRICE_RULE_IDS = new Set(["D6", "D7", "E6", "E7", "NN1"]);

type Num = number | null;

const ruleEvidence = (r: RuleResult): Evidence => ({ kind: "RULE", ref: r.id, status: r.status, period: r.period });

function strategyScreen(inputs: DecisionInputs, s: Strategy): ScreenResult {
  return s === "DEFENSIVE" ? inputs.graham.defensive : s === "ENTERPRISING" ? inputs.graham.enterprising : inputs.graham.netNet.screen;
}

function strategyCeiling(inputs: DecisionInputs, s: Strategy): CeilingRow {
  return s === "DEFENSIVE" ? inputs.dashboard.defensive : s === "ENTERPRISING" ? inputs.dashboard.enterprising : inputs.dashboard.netNet;
}

/** Counted rules split into business (non-price) criteria and price criteria. */
export function splitCriteria(screen: ScreenResult) {
  const counted = screen.rules.filter((r) => r.counted && r.status !== "NOT_APPLICABLE");
  const business = counted.filter((r) => !PRICE_RULE_IDS.has(r.id));
  const price = counted.filter((r) => PRICE_RULE_IDS.has(r.id));
  const ids = (rs: RuleResult[], st: RuleResult["status"]) => rs.filter((r) => r.status === st).map((r) => r.id);
  return {
    business,
    price,
    businessFailed: ids(business, "FAIL"),
    businessInsufficient: ids(business, "INSUFFICIENT_DATA"),
    priceFailed: ids(price, "FAIL"),
    priceInsufficient: ids(price, "INSUFFICIENT_DATA"),
  };
}

/** Net-Net "business" requirement: positive net current asset value (NN1's first check). */
function netNetBusiness(inputs: DecisionInputs): { failed: boolean; unknown: boolean } {
  const n = inputs.graham.netNet.ncav;
  if (n === null) return { failed: false, unknown: true };
  return { failed: n <= 0, unknown: false };
}

// ─────────────────────────────── factors ───────────────────────────────

function screenFactor(id: "defensive" | "enterprising", screen: ScreenResult, inStrategy: boolean): FactorAssessment {
  const c = splitCriteria(screen);
  const evidence = screen.rules.filter((r) => r.counted).map(ruleEvidence);
  const params = {
    passed: screen.passed,
    failed: screen.failed,
    insufficient: screen.insufficient,
    businessFailed: c.businessFailed.join(", ") || "—",
    priceFailed: c.priceFailed.join(", ") || "—",
    missing: [...c.businessInsufficient, ...c.priceInsufficient].join(", ") || "—",
    unverified: screen.unverifiedCounted,
  };
  let status: FactorStatus;
  let reason: string;
  if (screen.ruleSet === "NONE" || screen.outcome === "NOT_APPLICABLE") [status, reason] = ["NOT_APPLICABLE", "screenNotApplicable"];
  else if (c.businessFailed.length > 0) [status, reason] = ["UNFAVORABLE", "failsBusinessCriteria"];
  else if (c.businessInsufficient.length > 0) [status, reason] = ["UNKNOWN", "businessCriteriaIncomplete"];
  else if (c.priceFailed.length > 0) [status, reason] = ["NEUTRAL", "failsPriceCriteriaOnly"];
  else if (c.priceInsufficient.length > 0) [status, reason] = ["UNKNOWN", "priceCriteriaIncomplete"];
  else [status, reason] = ["FAVORABLE", "meetsAllCriteria"];
  return { id, status, reason, params, evidence, inStrategy };
}

function netNetFactor(inputs: DecisionInputs, inStrategy: boolean): FactorAssessment {
  const nn = inputs.graham.netNet;
  const rule = findRule(nn.screen, "NN1");
  const evidence: Evidence[] = rule ? [ruleEvidence(rule)] : [];
  evidence.push({ kind: "CEILING", ref: "netNet", value: nn.purchaseThreshold, unit: "perShare" });
  const params = { ncavPerShare: nn.ncavPerShare ?? "—", threshold: nn.purchaseThreshold ?? "—" };
  let status: FactorStatus;
  let reason: string;
  if (!rule || rule.status === "NOT_APPLICABLE") [status, reason] = ["NOT_APPLICABLE", "screenNotApplicable"];
  else if (nn.ncav !== null && nn.ncav <= 0) [status, reason] = ["UNFAVORABLE", "nonPositiveNcav"];
  else if (rule.status === "PASS") [status, reason] = ["FAVORABLE", "belowNetNetThreshold"];
  else if (rule.status === "FAIL") [status, reason] = ["NEUTRAL", "aboveNetNetThreshold"];
  else [status, reason] = ["UNKNOWN", "netNetIncomplete"];
  return { id: "netNet", status, reason, params, evidence, inStrategy };
}

function risk(inputs: DecisionInputs, id: RiskIndicator["id"]): RiskIndicator | undefined {
  return inputs.graham.netNet.risks.find((r) => r.id === id);
}

function financialStrengthFactor(inputs: DecisionInputs): FactorAssessment {
  const { defensive, enterprising, trends, classification } = inputs.graham;
  const d2 = findRule(defensive, "D2") ?? findRule(defensive, "D2U");
  const e1 = findRule(enterprising, "E1");
  const e2 = findRule(enterprising, "E2");
  const debtRisk = risk(inputs, "debtMaturity");
  const lastTrend = trends[trends.length - 1];
  const bvps = lastTrend?.bookValuePerShare ?? null;
  const evidence: Evidence[] = [d2, e1, e2].filter((r): r is RuleResult => Boolean(r)).map(ruleEvidence);
  if (debtRisk) evidence.push({ kind: "RISK", ref: "debtMaturity", status: debtRisk.level, period: debtRisk.period });
  if (lastTrend) evidence.push({ kind: "RULE", ref: "BVPS", value: bvps, unit: "perShare", period: `FY${lastTrend.fiscalYear}` });
  const params: Record<string, string | number> = { industryClass: classification.industryClass };
  const st = (r: RuleResult | undefined) => r?.status ?? "INSUFFICIENT_DATA";
  const allNa = [d2, e1, e2].every((r) => !r || r.status === "NOT_APPLICABLE");
  let status: FactorStatus;
  let reason: string;
  if (bvps !== null && bvps <= 0) [status, reason] = ["CRITICAL", "negativeEquity"];
  else if (debtRisk?.level === "HIGH") [status, reason] = ["CRITICAL", "debtMaturityHigh"];
  else if (allNa) [status, reason] = ["NOT_APPLICABLE", "financialIssuer"];
  else if (st(d2) === "PASS") [status, reason] = ["FAVORABLE", "meetsDefensiveCondition"];
  else if (st(e1) === "FAIL" || st(e2) === "FAIL") [status, reason] = ["UNFAVORABLE", "failsEnterprisingCondition"];
  else if (st(e1) === "PASS" && st(e2) === "PASS") [status, reason] = ["NEUTRAL", "meetsEnterprisingConditionOnly"];
  else [status, reason] = ["UNKNOWN", "financialConditionIncomplete"];
  return { id: "financialStrength", status, reason, params, evidence, inStrategy: true };
}

function earningsStabilityFactor(inputs: DecisionInputs): FactorAssessment {
  const d3 = findRule(inputs.graham.defensive, "D3");
  const e3 = findRule(inputs.graham.enterprising, "E3");
  const opLoss = risk(inputs, "operatingLosses");
  const evidence: Evidence[] = [d3, e3].filter((r): r is RuleResult => Boolean(r)).map(ruleEvidence);
  if (opLoss) evidence.push({ kind: "RISK", ref: "operatingLosses", status: opLoss.level, period: opLoss.period });
  const params: Record<string, string | number> = {
    deficitYears: String(d3?.reasonParams?.deficitYears ?? e3?.reasonParams?.deficitYears ?? "—"),
    missingYears: String(d3?.reasonParams?.missingYears ?? "—"),
  };
  let status: FactorStatus;
  let reason: string;
  if ((!d3 || d3.status === "NOT_APPLICABLE") && (!e3 || e3.status === "NOT_APPLICABLE")) [status, reason] = ["NOT_APPLICABLE", "screenNotApplicable"];
  else if (d3?.status === "PASS") [status, reason] = ["FAVORABLE", "tenYearsPositive"];
  else if (e3?.status === "FAIL") [status, reason] = ["UNFAVORABLE", "recentDeficit"];
  else if (e3?.status === "PASS" && d3?.status === "FAIL") [status, reason] = ["NEUTRAL", "fiveYearsPositiveOlderDeficit"];
  else if (e3?.status === "PASS") [status, reason] = ["NEUTRAL", "fiveYearsPositiveShortHistory"];
  else [status, reason] = ["UNKNOWN", "earningsHistoryIncomplete"];
  return { id: "earningsStability", status, reason, params, evidence, inStrategy: true };
}

/** Reference value and the price above which valuation counts as excessive. */
function excessiveLevel(inputs: DecisionInputs, row: CeilingRow): { value: Num; basis: "INTRINSIC" | "CEILING" | null } {
  const m = inputs.settings.excessiveValuationMultiple;
  const iv = inputs.intrinsic?.status === "ESTABLISHED" ? inputs.intrinsic.value : null;
  if (iv !== null && iv > 0) return { value: iv * m, basis: "INTRINSIC" };
  if (row.ceiling.status === "ESTABLISHED" && row.ceiling.value !== null && row.ceiling.value > 0) return { value: row.ceiling.value * m, basis: "CEILING" };
  return { value: null, basis: null };
}

function valuationFactor(inputs: DecisionInputs, strategy: Strategy): FactorAssessment {
  const row = strategyCeiling(inputs, strategy);
  const price = inputs.dashboard.price.comparable;
  const c = row.ceiling;
  const exc = excessiveLevel(inputs, row);
  const evidence: Evidence[] = [
    { kind: "CEILING", ref: c.id, status: c.status, value: c.value, unit: "perShare" },
    { kind: "PRICE", ref: inputs.dashboard.price.basis, value: price, unit: "perShare", period: inputs.dashboard.price.price?.date ?? null },
  ];
  if (exc.basis === "INTRINSIC") evidence.push({ kind: "INTRINSIC", ref: inputs.intrinsic!.method, value: inputs.intrinsic!.value, unit: "perShare" });
  const params: Record<string, string | number> = {
    ceiling: c.value ?? "—",
    price: price ?? "—",
    changeRequired: row.comparison.changeRequired ?? "—",
    priceToCeiling: price !== null && c.value !== null && c.value > 0 ? price / c.value : "—",
    excessiveAbove: exc.value ?? "—",
    multiple: inputs.settings.excessiveValuationMultiple,
    ceilingReason: c.reason,
  };
  let status: FactorStatus;
  let reason: string;
  if (c.status === "NOT_APPLICABLE") [status, reason] = ["NOT_APPLICABLE", "ceilingNotApplicable"];
  else if (price === null) [status, reason] = ["UNKNOWN", "noComparablePrice"];
  else if (c.status === "NOT_ESTABLISHED") {
    const nonPositive = c.reason.startsWith("nonPositive");
    [status, reason] = nonPositive ? ["UNFAVORABLE", "ceilingNotEstablishedNonPositive"] : ["UNKNOWN", "ceilingNotEstablishedMissing"];
  } else if (row.comparison.withinThreshold === true) [status, reason] = ["FAVORABLE", "withinCeiling"];
  else if (exc.value !== null && price > exc.value) [status, reason] = ["CRITICAL", exc.basis === "INTRINSIC" ? "excessiveVsIntrinsic" : "excessiveVsCeiling"];
  else [status, reason] = ["UNFAVORABLE", "aboveCeiling"];
  return { id: "valuation", status, reason, params, evidence, inStrategy: true };
}

function marginOfSafetyFactor(inputs: DecisionInputs, strategy: Strategy): FactorAssessment {
  const price = inputs.dashboard.price.comparable;
  const iv = inputs.intrinsic;
  const target = inputs.marginOfSafetyTarget;
  const params: Record<string, string | number> = { target: target * 100 };
  if (iv && iv.status === "ESTABLISHED" && iv.value !== null && iv.value > 0) {
    const evidence: Evidence[] = [{ kind: "INTRINSIC", ref: iv.method, status: iv.status, value: iv.value, unit: "perShare" }];
    if (price === null) return { id: "marginOfSafety", status: "UNKNOWN", reason: "noComparablePrice", params, evidence, inStrategy: true };
    const pct = ((iv.value - price) / iv.value) * 100;
    const targetPrice = iv.value * (1 - target);
    Object.assign(params, { percent: pct, intrinsicValue: iv.value, targetPrice, method: iv.method });
    evidence.push({ kind: "PRICE", ref: "comparable", value: price, unit: "perShare" });
    if (pct >= target * 100) return { id: "marginOfSafety", status: "FAVORABLE", reason: "meetsTarget", params, evidence, inStrategy: true };
    return { id: "marginOfSafety", status: "UNFAVORABLE", reason: pct < 0 ? "priceAboveIntrinsic" : "belowTarget", params, evidence, inStrategy: true };
  }
  // Net-Net: Graham's margin of safety is the discount to NCAV (purchase at ≤ 2/3).
  const ncavps = inputs.graham.netNet.ncavPerShare;
  if (strategy === "NET_NET" && ncavps !== null && ncavps > 0 && price !== null) {
    const discount = (1 - price / ncavps) * 100;
    Object.assign(params, { percent: discount, ncavPerShare: ncavps, targetPercent: (1 / 3) * 100 });
    const evidence: Evidence[] = [{ kind: "CEILING", ref: "netNet", value: inputs.graham.netNet.purchaseThreshold, unit: "perShare" }];
    const meets = inputs.graham.netNet.purchaseThreshold !== null && price <= inputs.graham.netNet.purchaseThreshold;
    return { id: "marginOfSafety", status: meets ? "FAVORABLE" : "UNFAVORABLE", reason: meets ? "ncavDiscountMeets" : "ncavDiscountBelow", params, evidence, inStrategy: true };
  }
  const reason = !iv || iv.status === "DISABLED" ? "intrinsicDisabled" : "intrinsicNotEstablished";
  params.intrinsicReason = iv?.reason ?? "disabled";
  return { id: "marginOfSafety", status: "UNKNOWN", reason, params, evidence: iv ? [{ kind: "INTRINSIC", ref: iv.method, status: iv.status }] : [], inStrategy: true };
}

/** Financial risks whose HIGH level is treated as unacceptable (application rule). */
const CRITICAL_RISKS = new Set<RiskIndicator["id"]>(["cashBurn", "debtMaturity"]);

function risksFactor(inputs: DecisionInputs): FactorAssessment {
  const risks = inputs.graham.netNet.risks;
  const evidence: Evidence[] = risks.map((r) => ({ kind: "RISK", ref: r.id, status: r.level, period: r.period }));
  const ids = (pred: (r: RiskIndicator) => boolean) => risks.filter(pred).map((r) => r.id);
  const highCritical = ids((r) => r.level === "HIGH" && CRITICAL_RISKS.has(r.id));
  const high = ids((r) => r.level === "HIGH");
  const watch = ids((r) => r.level === "WATCH");
  const known = risks.filter((r) => r.level !== "INSUFFICIENT_DATA");
  const params = { high: high.join(", ") || "—", watch: watch.join(", ") || "—", assessed: known.length, total: risks.length };
  let status: FactorStatus;
  let reason: string;
  if (risks.length === 0) [status, reason] = ["NOT_APPLICABLE", "risksNotAssessed"];
  else if (highCritical.length > 0) [status, reason] = ["CRITICAL", "unacceptableFinancialRisk"];
  else if (high.length > 0) [status, reason] = ["UNFAVORABLE", "highRisk"];
  else if (known.length === 0) [status, reason] = ["UNKNOWN", "risksInsufficientData"];
  else if (watch.length > 0) [status, reason] = ["NEUTRAL", "watchRisk"];
  else if (known.length < risks.length) [status, reason] = ["NEUTRAL", "lowRiskPartial"];
  else [status, reason] = ["FAVORABLE", "lowRisk"];
  return { id: "investmentRisks", status, reason, params, evidence, inStrategy: true };
}

function ownershipFactor(inputs: DecisionInputs): FactorAssessment {
  const p = inputs.position;
  const max = inputs.settings.maxPositionWeight;
  if (!p) return { id: "ownership", status: "NOT_APPLICABLE", reason: "notOwned", params: { maxWeight: max * 100 }, evidence: [], inStrategy: true };
  const evidence: Evidence[] = [
    { kind: "POSITION", ref: "weight", value: p.weight === null ? null : p.weight * 100, unit: "percent" },
    { kind: "SETTING", ref: "maxPositionWeight", value: max * 100, unit: "percent" },
  ];
  const params: Record<string, string | number> = { weight: p.weight === null ? "—" : p.weight * 100, maxWeight: max * 100, thesis: p.thesisStrategy ?? "—" };
  if (p.weight === null) return { id: "ownership", status: "UNKNOWN", reason: "weightUnknown", params, evidence, inStrategy: true };
  if (p.weight > max) return { id: "ownership", status: "UNFAVORABLE", reason: "concentrationExceeded", params, evidence, inStrategy: true };
  return { id: "ownership", status: "FAVORABLE", reason: "withinConcentrationLimit", params, evidence, inStrategy: true };
}

function dataQualityFactor(inputs: DecisionInputs): FactorAssessment {
  const g = inputs.gate;
  const errors = inputs.freshness.issues.filter((i) => i.severity === "ERROR");
  const basis = inputs.dashboard.price.basis;
  const evidence: Evidence[] = [
    ...g.missing.map((f) => ({ kind: "GATE" as const, ref: f, status: "MISSING" })),
    ...g.stale.map((f) => ({ kind: "GATE" as const, ref: f, status: "STALE" })),
    ...g.conflicting.map((f) => ({ kind: "GATE" as const, ref: f, status: "CONFLICT" })),
    { kind: "FRESHNESS", ref: "fundamentals", status: inputs.freshness.fundamentals.level, period: inputs.freshness.fundamentals.asOf },
    { kind: "FRESHNESS", ref: "price", status: basis, period: inputs.dashboard.price.price?.date ?? null },
  ];
  const v = inputs.verification;
  const params: Record<string, string | number> = {
    missing: g.missing.join(", ") || "—",
    stale: g.stale.join(", ") || "—",
    conflicting: g.conflicting.join(", ") || "—",
    errors: errors.map((e) => e.code).join(", ") || "—",
    verified: v?.verified ?? 0,
    singleSource: v?.singleSource ?? 0,
    unverified: v?.unverified ?? 0,
  };
  let status: FactorStatus;
  let reason: string;
  if (g.notes.includes("DEV_FIXTURE")) [status, reason] = ["CRITICAL", "devFixtureData"];
  else if (g.missing.length > 0) [status, reason] = ["CRITICAL", "requiredDataMissing"];
  else if (g.conflicting.length > 0) [status, reason] = ["CRITICAL", "dataConflict"];
  else if (g.stale.length > 0) [status, reason] = ["CRITICAL", "dataStale"];
  else if (!g.sufficient) [status, reason] = ["CRITICAL", "gateFailed"];
  else if (errors.length > 0) [status, reason] = ["CRITICAL", "validationErrors"];
  else if (basis !== "CURRENT") [status, reason] = ["CRITICAL", "historicalPriceOnly"];
  else if (!v || v.verified === 0) [status, reason] = ["NEUTRAL", "notCrossVerified"];
  else if (v.singleSource > 0 || v.unverified > 0) [status, reason] = ["NEUTRAL", "partlyCrossVerified"];
  else [status, reason] = ["FAVORABLE", "verifiedAndCurrent"];
  return { id: "dataQuality", status, reason, params, evidence, inStrategy: true };
}

// ─────────────────────────────── classification ───────────────────────────────

const st = (code: string, factor: FactorId | null, params: Record<string, string | number> = {}, evidence: Evidence[] = []): CodedStatement => ({ code, factor, params, evidence });

export function evaluateDecision(inputs: DecisionInputs): DecisionResult {
  const owned = inputs.position !== null;
  const strategy: Strategy = owned && inputs.position!.thesisStrategy ? inputs.position!.thesisStrategy : inputs.strategy;
  const strategySource = owned && inputs.position!.thesisStrategy ? "POSITION_THESIS" : "SELECTED";

  const fDef = screenFactor("defensive", inputs.graham.defensive, strategy === "DEFENSIVE");
  const fEnt = screenFactor("enterprising", inputs.graham.enterprising, strategy === "ENTERPRISING");
  const fNN = netNetFactor(inputs, strategy === "NET_NET");
  const fFin = financialStrengthFactor(inputs);
  const fEarn = earningsStabilityFactor(inputs);
  const fVal = valuationFactor(inputs, strategy);
  const fMos = marginOfSafetyFactor(inputs, strategy);
  const fRisk = risksFactor(inputs);
  const fOwn = ownershipFactor(inputs);
  const fData = dataQualityFactor(inputs);
  const factors = [fDef, fEnt, fNN, fFin, fEarn, fVal, fMos, fRisk, fOwn, fData];
  const factorOf = (s: Strategy) => (s === "DEFENSIVE" ? fDef : s === "ENTERPRISING" ? fEnt : fNN);
  const fStrategy = factorOf(strategy);

  const screen = strategyScreen(inputs, strategy);
  const crit = splitCriteria(screen);
  const nnBiz = netNetBusiness(inputs);
  const businessFailed = strategy === "NET_NET" ? (nnBiz.failed ? ["NN1"] : []) : crit.businessFailed;
  const businessUnknown = strategy === "NET_NET" ? (nnBiz.unknown ? ["NN1"] : []) : crit.businessInsufficient;
  const ruleEv = (ids: string[]) => ids.map((id) => findRule(screen, id)).filter((r): r is RuleResult => Boolean(r)).map(ruleEvidence);

  const row = strategyCeiling(inputs, strategy);
  const exc = excessiveLevel(inputs, row);
  const ivEstablished = inputs.intrinsic?.status === "ESTABLISHED" && inputs.intrinsic.value !== null;
  const keyFigures: KeyFigures = {
    currency: inputs.dashboard.currency,
    price: inputs.dashboard.price.comparable,
    priceDate: inputs.dashboard.price.price?.date ?? null,
    priceBasis: inputs.dashboard.price.basis,
    ceiling: row.ceiling.value,
    ceilingStrict: row.ceiling.strict,
    excessiveAbove: exc.value,
    excessiveBasis: exc.basis,
    intrinsicValue: ivEstablished ? inputs.intrinsic!.value : null,
    marginOfSafetyPercent: typeof fMos.params.percent === "number" ? fMos.params.percent : null,
    marginOfSafetyTargetPrice: typeof fMos.params.targetPrice === "number" ? fMos.params.targetPrice : null,
    ncavPerShare: inputs.graham.netNet.ncavPerShare,
    grahamNumber: inputs.dashboard.grahamNumber.ceiling.value,
  };

  const reasons: CodedStatement[] = [];
  const reviewTriggers: CodedStatement[] = [];
  const caveats: CodedStatement[] = [];
  let category: DecisionCategory;

  if (fData.status === "CRITICAL") {
    category = "INSUFFICIENT_VERIFIED_DATA";
    reasons.push(st(`data.${fData.reason}`, "dataQuality", fData.params, fData.evidence));
    if (owned) reasons.push(st("owned.noReviewOnUnreliableData", "ownership"));
  } else if (screen.ruleSet === "NONE" || fStrategy.status === "NOT_APPLICABLE") {
    category = "INSUFFICIENT_VERIFIED_DATA";
    reasons.push(st("strategyNotApplicable", fStrategy.id, { strategy, industryClass: inputs.graham.classification.industryClass }));
  } else if (owned) {
    if (businessFailed.length > 0)
      reviewTriggers.push(st("trigger.thesisInvalidated", fStrategy.id, { strategy, rules: businessFailed.join(", ") }, ruleEv(businessFailed)));
    if (fRisk.status === "CRITICAL" || fFin.status === "CRITICAL" || fEarn.status === "UNFAVORABLE" || fFin.status === "UNFAVORABLE") {
      const which = [fRisk, fFin, fEarn].filter((f) => f.status === "CRITICAL" || (f.id !== "investmentRisks" && f.status === "UNFAVORABLE"));
      reviewTriggers.push(st("trigger.fundamentalsDeteriorated", which[0]?.id ?? null, { factors: which.map((f) => f.id).join(", ") }, which.flatMap((f) => f.evidence)));
    }
    if (fVal.status === "CRITICAL")
      reviewTriggers.push(st("trigger.valuationExcessive", "valuation", { price: fVal.params.price, excessiveAbove: fVal.params.excessiveAbove, multiple: fVal.params.multiple, basis: exc.basis ?? "—" }, fVal.evidence));
    if (fOwn.status === "UNFAVORABLE") reviewTriggers.push(st("trigger.concentration", "ownership", fOwn.params, fOwn.evidence));

    if (reviewTriggers.length > 0) {
      category = "REVIEW_FOR_SALE";
      reasons.push(st("review.triggered", null, { count: reviewTriggers.length }));
    } else if (businessUnknown.length > 0) {
      category = "INSUFFICIENT_VERIFIED_DATA";
      reasons.push(st("thesisCannotBeConfirmed", fStrategy.id, { rules: businessUnknown.join(", ") }, ruleEv(businessUnknown)));
    } else {
      category = "HOLD";
      reasons.push(st("hold.thesisIntact", fStrategy.id, { strategy }, ruleEv(crit.business.map((r) => r.id))));
      if (fVal.status !== "FAVORABLE") reasons.push(st("hold.priceAboveCeilingNotExcessive", "valuation", fVal.params, fVal.evidence));
    }
  } else if (businessFailed.length > 0) {
    category = "AVOID";
    reasons.push(st("avoid.failsStrategyRequirements", fStrategy.id, { strategy, rules: businessFailed.join(", ") }, ruleEv(businessFailed)));
  } else if (fRisk.status === "CRITICAL" || fFin.status === "CRITICAL") {
    category = "AVOID";
    const f = fRisk.status === "CRITICAL" ? fRisk : fFin;
    reasons.push(st("avoid.unacceptableFinancialRisk", f.id, f.params, f.evidence));
  } else if (businessUnknown.length > 0) {
    category = "INSUFFICIENT_VERIFIED_DATA";
    reasons.push(st("businessCriteriaIncomplete", fStrategy.id, { rules: businessUnknown.join(", ") }, ruleEv(businessUnknown)));
  } else if (fVal.status === "UNKNOWN") {
    category = "INSUFFICIENT_VERIFIED_DATA";
    reasons.push(st(`valuation.${fVal.reason}`, "valuation", fVal.params, fVal.evidence));
  } else if (fVal.status === "UNFAVORABLE" && fVal.reason === "ceilingNotEstablishedNonPositive") {
    category = "AVOID";
    reasons.push(st("avoid.noQualifyingPrice", "valuation", fVal.params, fVal.evidence));
  } else if (fVal.status === "UNFAVORABLE" || fVal.status === "CRITICAL") {
    category = "WAIT";
    reasons.push(st("wait.priceAboveCeiling", "valuation", fVal.params, fVal.evidence));
  } else if (fMos.status === "UNFAVORABLE") {
    category = "WAIT";
    reasons.push(st("wait.marginOfSafetyAbsent", "marginOfSafety", fMos.params, fMos.evidence));
  } else if (fMos.status === "UNKNOWN" && inputs.settings.requireIntrinsicMarginOfSafety) {
    category = "INSUFFICIENT_VERIFIED_DATA";
    reasons.push(st("marginOfSafetyRequired", "marginOfSafety", fMos.params, fMos.evidence));
  } else {
    category = "BUY_CANDIDATE";
    reasons.push(st("buy.allCriteriaMet", fStrategy.id, { strategy }, ruleEv(screen.rules.filter((r) => r.counted).map((r) => r.id))));
    reasons.push(st("buy.withinCeiling", "valuation", fVal.params, fVal.evidence));
  }

  // Qualifications for the positive categories.
  let confidence: DecisionResult["confidence"] = null;
  if (category === "BUY_CANDIDATE" || category === "HOLD") {
    if (screen.unverifiedCounted > 0 || (strategy === "NET_NET" && findRule(screen, "NN1")?.verification === "UNVERIFIED"))
      caveats.push(st("caveat.unverifiedRuleWording", fStrategy.id, { rules: screen.rules.filter((r) => r.counted && r.verification === "UNVERIFIED").map((r) => r.id).join(", ") || "NN1" }));
    if (fMos.status === "UNKNOWN") caveats.push(st("caveat.noIntrinsicMargin", "marginOfSafety", fMos.params));
    if (fData.status !== "FAVORABLE") caveats.push(st(`caveat.${fData.reason}`, "dataQuality", fData.params));
    if (fRisk.status === "UNFAVORABLE" || fRisk.status === "NEUTRAL" || fRisk.status === "UNKNOWN") caveats.push(st("caveat.risks", "investmentRisks", fRisk.params, fRisk.evidence));
    if (fFin.status === "UNKNOWN" || fFin.status === "NEUTRAL") caveats.push(st("caveat.financialStrength", "financialStrength", fFin.params, fFin.evidence));
    if (ivEstablished && inputs.intrinsic!.terminalHeavy) caveats.push(st("caveat.terminalHeavy", "marginOfSafety", { share: (inputs.intrinsic!.terminalShare ?? 0) * 100 }));
    if (owned && fOwn.status === "UNKNOWN") caveats.push(st("caveat.weightUnknown", "ownership"));
    if (owned && strategySource === "SELECTED") caveats.push(st("caveat.thesisNotRecorded", "ownership", { strategy }));
    confidence = caveats.length === 0 ? "STANDARD" : "LOW";
  }
  if (category === "AVOID" || category === "WAIT") caveats.push(st("caveat.strategyRelative", fStrategy.id, { strategy }));
  if (fVal.status !== "FAVORABLE" && fVal.status !== "NOT_APPLICABLE" && fVal.status !== "UNKNOWN") caveats.push(st("caveat.priceRulesNotQuality", "valuation"));

  return {
    status: "EVALUATED",
    engineVersion: DECISION_ENGINE_VERSION,
    methodology: "APPLICATION_CLASSIFICATION",
    category,
    strategy,
    selectedStrategy: inputs.strategy,
    strategySource,
    owned,
    confidence,
    reasons,
    reviewTriggers,
    caveats,
    conditions: changeConditions({ inputs, category, strategy, businessFailed, businessUnknown, fVal, fMos, fRisk, fOwn, fData, keyFigures, screen }),
    factors,
    keyFigures,
  };
}

// ─────────────────────────────── what would change it ───────────────────────────────

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function changeConditions(p: {
  inputs: DecisionInputs;
  category: DecisionCategory;
  strategy: Strategy;
  businessFailed: string[];
  businessUnknown: string[];
  fVal: FactorAssessment;
  fMos: FactorAssessment;
  fRisk: FactorAssessment;
  fOwn: FactorAssessment;
  fData: FactorAssessment;
  keyFigures: KeyFigures;
  screen: ScreenResult;
}): CodedStatement[] {
  const { inputs, category, keyFigures: k } = p;
  const out: CodedStatement[] = [];
  const price = k.price;
  const pct = (to: number) => (price !== null && price > 0 ? ((to - price) / price) * 100 : "—");
  const ceilingEv: Evidence[] = [{ kind: "CEILING", ref: strategyCeiling(inputs, p.strategy).ceiling.id, value: k.ceiling, unit: "perShare" }];

  switch (category) {
    case "INSUFFICIENT_VERIFIED_DATA": {
      const g = inputs.gate;
      for (const f of g.missing) out.push(st("cond.provideMissing", "dataQuality", { field: f }));
      for (const f of g.stale) out.push(st("cond.refreshStale", "dataQuality", { field: f }));
      for (const f of g.conflicting) out.push(st("cond.resolveConflict", "dataQuality", { field: f }));
      if (g.notes.includes("DEV_FIXTURE")) out.push(st("cond.useRealData", "dataQuality"));
      if (p.fData.status === "CRITICAL" && p.fData.reason === "historicalPriceOnly") out.push(st("cond.currentPrice", "dataQuality"));
      for (const id of p.businessUnknown) out.push(st("cond.completeRule", null, { rule: id }));
      if (p.fVal.status === "UNKNOWN") out.push(st("cond.establishCeiling", "valuation", { reason: String(p.fVal.params.ceilingReason) }));
      if (p.fMos.status === "UNKNOWN" && inputs.settings.requireIntrinsicMarginOfSafety) out.push(st("cond.establishIntrinsic", "marginOfSafety"));
      if (out.length === 0) out.push(st("cond.strategyApplicable", null, { strategy: p.strategy }));
      break;
    }
    case "AVOID":
      for (const id of p.businessFailed) out.push(st("cond.rulePasses", null, { rule: id }, [{ kind: "RULE", ref: id, status: "FAIL" }]));
      if (p.fRisk.status === "CRITICAL") out.push(st("cond.riskImproves", "investmentRisks", p.fRisk.params, p.fRisk.evidence));
      if (p.fVal.reason === "ceilingNotEstablishedNonPositive") out.push(st("cond.positiveEarningsOrAssets", "valuation", { reason: String(p.fVal.params.ceilingReason) }));
      out.push(st("cond.otherStrategy", null, { strategy: p.strategy }));
      break;
    case "WAIT":
      if (k.ceiling !== null) out.push(st(k.ceilingStrict ? "cond.priceBelowCeiling" : "cond.priceAtOrBelowCeiling", "valuation", { ceiling: k.ceiling, change: pct(k.ceiling) }, ceilingEv));
      if (k.marginOfSafetyTargetPrice !== null && p.fMos.status === "UNFAVORABLE")
        out.push(st("cond.priceAtOrBelowMosTarget", "marginOfSafety", { targetPrice: k.marginOfSafetyTargetPrice, change: pct(k.marginOfSafetyTargetPrice), target: inputs.marginOfSafetyTarget * 100 }));
      out.push(st("cond.newFilingRaisesCeiling", "valuation"));
      out.push(st("cond.businessStillQualifies", null, { strategy: p.strategy }));
      break;
    case "BUY_CANDIDATE":
      if (k.ceiling !== null) out.push(st("cond.priceRisesAboveCeiling", "valuation", { ceiling: k.ceiling, change: pct(k.ceiling) }, ceilingEv));
      if (k.marginOfSafetyTargetPrice !== null) out.push(st("cond.priceRisesAboveMosTarget", "marginOfSafety", { targetPrice: k.marginOfSafetyTargetPrice, change: pct(k.marginOfSafetyTargetPrice) }));
      out.push(st("cond.newFilingFailsRule", null, { strategy: p.strategy }));
      out.push(st("cond.riskBecomesHigh", "investmentRisks"));
      break;
    case "HOLD":
    case "REVIEW_FOR_SALE":
      if (k.excessiveAbove !== null) out.push(st("cond.priceAboveExcessive", "valuation", { level: k.excessiveAbove, change: pct(k.excessiveAbove), basis: k.excessiveBasis ?? "—" }));
      if (inputs.position) {
        const w = inputs.position.weight;
        out.push(st("cond.weightAboveMax", "ownership", { maxWeight: inputs.settings.maxPositionWeight * 100, weight: w === null ? "—" : w * 100 }));
      }
      if (category === "REVIEW_FOR_SALE") out.push(st("cond.triggersResolved", null));
      else out.push(st("cond.newFilingFailsRule", null, { strategy: p.strategy }));
      out.push(st("cond.priceFallNotATrigger", null));
      break;
  }
  // Every positive or waiting classification depends on the statements staying current.
  const asOf = inputs.freshness.fundamentals.asOf;
  if (asOf && category !== "INSUFFICIENT_VERIFIED_DATA") out.push(st("cond.statementsBecomeStale", "dataQuality", { date: addMonths(asOf, inputs.fundamentalsStaleMonths ?? 24) }));
  return out;
}

export { strategyScreen, strategyCeiling };
