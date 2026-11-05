/**
 * Graham rules engine — The Intelligent Investor, fourth revised edition (1973).
 *
 *  - Defensive investor: Chapter 14 (D1–D7), with Graham's public-utility
 *    variants (D1U, D2U) and the modern inflation-adjusted size comparison
 *    (D1-M, advisory).
 *  - Enterprising investor: Chapter 15 Stock Guide criteria (E1–E7). These are
 *    the statistical criteria for secondary companies only; the other
 *    enterprising approaches (Chapters 6 and 7: bargain issues, special
 *    situations, relatively unpopular large companies…) are NOT screened here.
 *
 * Every rule is deterministic arithmetic over normalized, sourced data and
 * carries its registry entry (category + verification), formula, inputs,
 * checks, explanation, sources and reporting period. A rule PASSes or FAILs
 * only when the data proves it; otherwise it is INSUFFICIENT_DATA. Missing
 * values are never replaced with zero. Rules that do not fit the issuer type
 * are NOT_APPLICABLE (registry AI-SECTOR).
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { classifyIssuer, isFinancialEnterprise, type IndustryClass, type IndustryClassification } from "./classification";
import { dividendEvidence, dividendsInWindow } from "./dividends";
import {
  absentMeansNone,
  average,
  byYear,
  commonEquityNoted,
  parentEquityNoted,
  currentDebtNoted,
  earningsForCommon,
  eps,
  latest,
  longTermDebtNoted,
  sharesNoted,
  sortAnnual,
  type Noted,
  type Num,
} from "./metrics";
import { CPI_DEFAULT, registryEntry } from "./registry";
import type {
  CheckOp,
  FilingProvenance,
  GrahamInputs,
  InputValue,
  RuleCheck,
  RuleResult,
  RuleStatus,
  ScreenKind,
  ScreenOutcome,
  ScreenResult,
  SourceRef,
  ValueUnit,
} from "./types";

export const GRAHAM_ENGINE_VERSION = "2.0.0";

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
  /** E6 (UNVERIFIED): 9 × average earnings, price ≤ 120% of that value. */
  earningsMultiplier: 9,
  maxPriceToEarningsValue: 1.2,
  maxPriceToNetTangibleAssets: 1.2,
} as const;

// ─────────────────────────────── evaluation context ───────────────────────────────

export interface EvalContext {
  inputs: GrahamInputs;
  annual: AnnualFinancials[];
  last: AnnualFinancials | null;
  lastYear: number | null;
  map: Map<number, AnnualFinancials>;
  currency: string | undefined;
  /** Price in the statements' currency, or null. */
  price: Num;
  priceReason: "missingPrice" | "priceCurrencyMismatch" | null;
  provenance: Map<number, FilingProvenance>;
  classification: IndustryClassification;
}

export function buildContext(inputs: GrahamInputs): EvalContext {
  const annual = sortAnnual(inputs.annual);
  const last = latest(annual);
  const currency = last?.currency;
  let price: Num = null;
  let priceReason: EvalContext["priceReason"] = null;
  if (!inputs.price) priceReason = "missingPrice";
  else if (!currency || inputs.price.currency !== currency) priceReason = "priceCurrencyMismatch";
  else price = inputs.price.value;
  const classification =
    inputs.classification ??
    (inputs.isUtility ? { industryClass: "UTILITY" as const, basis: "UTILITY_FLAG" as const, sicCode: null } : classifyIssuer({ latest: last }));
  return {
    inputs,
    annual,
    last,
    lastYear: last?.fiscalYear ?? null,
    map: byYear(annual),
    currency,
    price,
    priceReason,
    provenance: new Map((inputs.provenance ?? []).map((p) => [p.fiscalYear, p])),
    classification,
  };
}

// ─────────────────────────────── result helpers ───────────────────────────────

export function fyLabel(ctx: EvalContext, y: number): string {
  const p = ctx.provenance.get(y) ?? ctx.map.get(y);
  return p ? `FY${y} (${p.periodEnd})` : `FY${y}`;
}

export function periodLabel(ctx: EvalContext, years: number[]): string | null {
  if (!years.length) return null;
  const sorted = [...years].sort((a, b) => a - b);
  return sorted.length === 1 ? fyLabel(ctx, sorted[0]) : `FY${sorted[0]}–FY${sorted[sorted.length - 1]}`;
}

export function filingSources(ctx: EvalContext, years: number[]): SourceRef[] {
  const out: SourceRef[] = [];
  for (const y of [...new Set(years)].sort((a, b) => b - a)) {
    const p = ctx.provenance.get(y);
    const a = ctx.map.get(y);
    if (!p && !a) continue;
    out.push({
      kind: "FILING",
      label: p ? [p.sourceName, p.form].filter(Boolean).join(" · ") : "Annual financials",
      period: fyLabel(ctx, y),
      url: p?.filingUrl ?? null,
    });
  }
  return out;
}

export function priceSources(ctx: EvalContext): SourceRef[] {
  const p = ctx.inputs.price;
  return p ? [{ kind: "PRICE", label: p.sourceName ?? "Price", period: p.date, url: null }] : [];
}

export function check(key: string, actual: Num, op: CheckOp, threshold: Num, unit: ValueUnit, passed?: boolean | null): RuleCheck {
  let p: boolean | null;
  if (passed !== undefined) p = passed;
  else if (actual === null || threshold === null) p = null;
  else p = op === ">=" ? actual >= threshold : op === "<=" ? actual <= threshold : op === "<" ? actual < threshold : actual > threshold;
  return { key, actual, op, threshold, unit, passed: p };
}

export function input(key: string, n: Noted | Num | undefined, unit: ValueUnit, fiscalYear?: number | null): InputValue {
  const noted: Noted = n === undefined ? { value: null, note: "missing" } : typeof n === "object" && n !== null ? n : { value: n, note: n === null ? "missing" : undefined };
  return { key, value: noted.value, unit, ...(fiscalYear !== undefined && { fiscalYear }), ...(noted.note && { note: noted.note }) };
}

export function statusFrom(checks: RuleCheck[], combinator: "ALL" | "ANY"): RuleStatus {
  const states = checks.map((c) => c.passed);
  if (combinator === "ALL") {
    if (states.some((s) => s === false)) return "FAIL";
    if (states.every((s) => s === true)) return "PASS";
    return "INSUFFICIENT_DATA";
  }
  if (states.some((s) => s === true)) return "PASS";
  if (states.every((s) => s === false)) return "FAIL";
  return "INSUFFICIENT_DATA";
}

interface RuleSpec {
  registryId?: string;
  formula: string;
  inputs: InputValue[];
  checks: RuleCheck[];
  combinator?: "ALL" | "ANY";
  status?: RuleStatus;
  reason: string | ((status: RuleStatus) => string);
  reasonParams?: Record<string, string | number>;
  assumptions?: string[];
  sources?: SourceRef[];
  period?: string | null;
  counted?: boolean;
}

export function makeRule(id: string, screen: ScreenKind, spec: RuleSpec): RuleResult {
  const reg = registryEntry(spec.registryId ?? id);
  const combinator = spec.combinator ?? "ALL";
  const status = spec.status ?? statusFrom(spec.checks, combinator);
  const assumptions = new Set(spec.assumptions ?? []);
  if (spec.inputs.some((i) => i.note === "inferredAbsent")) assumptions.add("AI-ABSENT-LINE");
  if (spec.inputs.some((i) => i.note === "derived" && i.key === "totalLiabilities")) assumptions.add("X-TL");
  if (spec.inputs.some((i) => i.note !== undefined && i.note !== "missing" && (i.key === "stockholdersEquity" || i.key === "commonEquity"))) assumptions.add("AI-EQUITY-NCI");
  return {
    id,
    screen,
    status,
    counted: spec.counted ?? true,
    category: reg.category,
    verification: reg.verification,
    citation: reg.citation,
    formula: spec.formula,
    inputs: spec.inputs,
    checks: spec.checks,
    combinator,
    reason: typeof spec.reason === "function" ? spec.reason(status) : spec.reason,
    ...(spec.reasonParams && { reasonParams: spec.reasonParams }),
    assumptions: [...assumptions],
    sources: spec.sources ?? [],
    period: spec.period ?? null,
  };
}

export function notApplicable(id: string, screen: ScreenKind, industryClass: IndustryClass, registryId?: string): RuleResult {
  const reg = registryEntry(registryId ?? id);
  return {
    id,
    screen,
    status: "NOT_APPLICABLE",
    counted: true,
    category: reg.category,
    verification: reg.verification,
    citation: reg.citation,
    formula: "—",
    inputs: [],
    checks: [],
    combinator: "ALL",
    reason: "notApplicableIssuerType",
    reasonParams: { industryClass },
    assumptions: ["AI-SECTOR"],
    sources: [],
    period: null,
  };
}

function toUsd(amount: Num, ctx: EvalContext): Num {
  if (amount === null) return null;
  if (ctx.currency === "USD") return amount;
  const fx = ctx.inputs.fxToUsd;
  return fx && fx > 0 ? amount * fx : null;
}

function yearsBack(lastYear: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lastYear - n + 1 + i);
}

/** Average EPS over explicit years; all must be known (registry X-AVG3). */
function avgEps(ctx: EvalContext, years: number[]): Num {
  return average(years.map((y) => eps(ctx.map.get(y))));
}

function epsInputs(ctx: EvalContext, years: number[]): InputValue[] {
  return years.map((y) => input("eps", eps(ctx.map.get(y)), "perShare", y));
}

function noFinancials(id: string, screen: ScreenKind, formula: string, registryId?: string): RuleResult {
  return makeRule(id, screen, { registryId, formula, inputs: [], checks: [], status: "INSUFFICIENT_DATA", reason: "noFinancials" });
}

/** Rules each issuer type gets (registry AI-SECTOR). */
export function isApplicable(industryClass: IndustryClass, ruleId: string): boolean {
  switch (industryClass) {
    case "INDUSTRIAL":
      return !["D1U", "D2U"].includes(ruleId);
    case "UTILITY":
      return !["D1", "D2", "E1", "E2", "NN1"].includes(ruleId);
    case "BANK":
    case "INSURANCE":
      return !["D1", "D1U", "D1-M", "D2", "D2U", "E1", "E2", "E7", "NN1"].includes(ruleId);
    default:
      return false; // REIT, ETF, OTHER_FINANCIAL
  }
}

// ─────────────────────────────── shared rule bodies ───────────────────────────────

function earningsStabilityRule(ctx: EvalContext, id: "D3" | "E3", screen: ScreenKind, years: number): RuleResult {
  const formula = `NetIncome(y) > 0  ∀ y ∈ [Y−${years - 1}, Y]`;
  if (ctx.lastYear === null) return noFinancials(id, screen, formula);
  const ys = yearsBack(ctx.lastYear, years);
  const values = ys.map((y) => [y, earningsForCommon(ctx.map.get(y))] as const);
  const known = values.filter(([, v]) => v !== null);
  const deficits = known.filter(([, v]) => v! <= 0).map(([y]) => y);
  const missing = values.filter(([, v]) => v === null).map(([y]) => y);
  const positive = known.length - deficits.length;
  return makeRule(id, screen, {
    formula,
    inputs: values.map(([y, v]) => input("netIncome", v, "currency", y)),
    checks: [check("profitableYears", positive, ">=", years, "count", deficits.length > 0 ? false : missing.length === 0 ? true : null)],
    reason: (s) => (s === "FAIL" ? "deficitYearFound" : s === "PASS" ? "positiveEveryYear" : "historyTooShort"),
    reasonParams: { deficitYears: deficits.join(", ") || "—", missingYears: missing.join(", ") || "—", years },
    assumptions: ["AI-FY-WINDOW", "AI-EARNINGS-COMMON"],
    sources: filingSources(ctx, known.map(([y]) => y)),
    period: periodLabel(ctx, ys),
  });
}

function currentRatioParts(ctx: EvalContext) {
  const v = ctx.last?.values;
  const ca = v?.currentAssets ?? null;
  const cl = v?.currentLiabilities ?? null;
  const cr = ca !== null && cl !== null && cl > 0 ? ca / cl : null; // registry X-CR
  const nwc = ca !== null && cl !== null ? ca - cl : null; // registry X-NWC
  return { ca, cl, cr, nwc, zeroDenominator: cl !== null && cl <= 0 };
}

function currentRatioRule(ctx: EvalContext, id: "E1", screen: ScreenKind, min: number): RuleResult {
  const formula = `CA / CL ≥ ${min}`;
  if (!ctx.last) return noFinancials(id, screen, formula);
  const { ca, cl, cr, zeroDenominator } = currentRatioParts(ctx);
  return makeRule(id, screen, {
    formula,
    inputs: [input("currentAssets", ca, "currency", ctx.lastYear), input("currentLiabilities", cl, "currency", ctx.lastYear)],
    checks: [check("currentRatio", cr, ">=", min, "ratio")],
    reason: (s) => (s === "PASS" ? "currentRatioOk" : s === "FAIL" ? "currentRatioTooLow" : zeroDenominator ? "zeroDenominator" : "missingCurrentItems"),
    assumptions: ["X-CR"],
    sources: filingSources(ctx, [ctx.lastYear!]),
    period: fyLabel(ctx, ctx.lastYear!),
  });
}

/** Common equity and net tangible assets per share (registry AI-TANGIBLE, AI-SHARES). */
export function perShareBook(ctx: EvalContext) {
  const a = ctx.last;
  const parentEquity = parentEquityNoted(a);
  const equity = commonEquityNoted(a);
  const pref = absentMeansNone(a, "preferredStock");
  const goodwill = absentMeansNone(a, "goodwill");
  const intangibles = absentMeansNone(a, "intangibleAssets");
  const shares = sharesNoted(a);
  const bvps = equity.value !== null && shares.value !== null ? equity.value / shares.value : null;
  const tangible = equity.value !== null && goodwill.value !== null && intangibles.value !== null ? equity.value - goodwill.value - intangibles.value : null;
  const tbvps = tangible !== null && shares.value !== null ? tangible / shares.value : null;
  return { parentEquity, equity, pref, goodwill, intangibles, shares, bvps, tangible, tbvps };
}

// ───────────────────────────────── Defensive (Ch. 14) ─────────────────────────────────

export function evaluateDefensive(inputs: GrahamInputs): ScreenResult {
  return defensiveFromContext(buildContext(inputs));
}

export function defensiveFromContext(ctx: EvalContext): ScreenResult {
  const T = DEFENSIVE_THRESHOLDS;
  const cls = ctx.classification.industryClass;
  const S: ScreenKind = "DEFENSIVE";
  const L = ctx.lastYear;
  const rules: RuleResult[] = [];
  const push = (id: string, build: () => RuleResult) => rules.push(isApplicable(cls, id) ? build() : notApplicable(id, S, cls));

  // D1 / D1U — adequate size
  if (cls === "UTILITY") {
    push("D1U", () => {
      const formula = "TotalAssets(Y) ≥ $50,000,000 (1973 USD)";
      if (L === null) return noFinancials("D1U", S, formula);
      const raw = ctx.last!.values.totalAssets;
      const usd = toUsd(raw ?? null, ctx);
      return makeRule("D1U", S, {
        formula,
        inputs: [input("totalAssets", raw ?? null, "currency", L)],
        checks: [check("totalAssetsUsd", usd, ">=", T.minUtilityTotalAssetsUsd, "currencyUsd")],
        reason: (s) => (s !== "INSUFFICIENT_DATA" ? "comparedUtilityAssets" : raw === undefined ? "missingTotalAssets" : "needsFxRate"),
        sources: filingSources(ctx, [L]),
        period: fyLabel(ctx, L),
      });
    });
  } else {
    push("D1", () => {
      const formula = "Revenue(Y) ≥ $100,000,000 (1973 USD)";
      if (L === null) return noFinancials("D1", S, formula);
      const raw = ctx.last!.values.revenue;
      const usd = toUsd(raw ?? null, ctx);
      return makeRule("D1", S, {
        formula,
        inputs: [input("revenue", raw ?? null, "currency", L)],
        checks: [check("revenueUsd", usd, ">=", T.minAnnualSalesUsd, "currencyUsd")],
        reason: (s) => (s !== "INSUFFICIENT_DATA" ? "comparedSales" : raw === undefined ? "missingRevenue" : "needsFxRate"),
        sources: filingSources(ctx, [L]),
        period: fyLabel(ctx, L),
      });
    });
  }

  // D1-M — modern inflation-adjusted comparison (advisory)
  push("D1-M", () => {
    const cpi = ctx.inputs.cpi ?? CPI_DEFAULT;
    const utility = cls === "UTILITY";
    const base = utility ? T.minUtilityTotalAssetsUsd : T.minAnnualSalesUsd;
    const factor = cpi.baseValue > 0 && cpi.currentValue > 0 ? cpi.currentValue / cpi.baseValue : null;
    const threshold = factor === null ? null : base * factor;
    const raw = L === null ? undefined : utility ? ctx.last!.values.totalAssets : ctx.last!.values.revenue;
    const usd = toUsd(raw ?? null, ctx);
    return makeRule("D1-M", S, {
      formula: `${utility ? "TotalAssets" : "Revenue"}(Y) ≥ $${base / 1e6}M × CPI(${cpi.currentLabel}) / CPI(${cpi.baseYear})`,
      inputs: [
        input(utility ? "totalAssets" : "revenue", raw ?? null, "currency", L),
        input("cpiBase", cpi.baseValue, "index"),
        input("cpiCurrent", cpi.currentValue, "index"),
        input("inflationFactor", factor, "ratio"),
      ],
      checks: [check(utility ? "totalAssetsUsd" : "revenueUsd", usd, ">=", threshold, "currencyUsd")],
      reason: (s) => (s !== "INSUFFICIENT_DATA" ? "comparedInflationAdjusted" : L === null ? "noFinancials" : raw === undefined ? (utility ? "missingTotalAssets" : "missingRevenue") : "needsFxRate"),
      reasonParams: { cpiBaseYear: cpi.baseYear, cpiCurrentLabel: cpi.currentLabel },
      sources: [{ kind: "REFERENCE", label: cpi.sourceLabel, period: `${cpi.baseYear} → ${cpi.currentLabel}`, url: cpi.sourceUrl }, ...(L !== null ? filingSources(ctx, [L]) : [])],
      period: L !== null ? fyLabel(ctx, L) : null,
      counted: false,
    });
  });

  // D2 / D2U — financial condition
  if (cls === "UTILITY") {
    push("D2U", () => {
      const formula = "LTD ≤ 2 × CommonEquity";
      if (L === null) return noFinancials("D2U", S, formula);
      const ltd = longTermDebtNoted(ctx.last);
      const eq = commonEquityNoted(ctx.last);
      const limit = eq.value === null ? null : T.maxUtilityDebtToEquity * eq.value;
      return makeRule("D2U", S, {
        formula,
        inputs: [input("longTermDebt", ltd, "currency", L), input("commonEquity", eq, "currency", L)],
        checks: [check("longTermDebt", ltd.value, "<=", limit, "currency", eq.value !== null && eq.value <= 0 ? false : undefined)],
        reason: (s) => (s === "PASS" ? "comparedUtilityDebt" : s === "FAIL" ? (eq.value !== null && eq.value <= 0 ? "negativeEquity" : "comparedUtilityDebt") : ltd.value === null ? "missingLongTermDebt" : "missingEquity"),
        assumptions: ltd.note === "inferredAbsent" ? ["AI-LTD"] : [],
        sources: filingSources(ctx, [L]),
        period: fyLabel(ctx, L),
      });
    });
  } else {
    push("D2", () => {
      const formula = "CA / CL ≥ 2  ∧  LTD ≤ CA − CL";
      if (L === null) return noFinancials("D2", S, formula);
      const { ca, cl, cr, nwc, zeroDenominator } = currentRatioParts(ctx);
      const ltd = longTermDebtNoted(ctx.last);
      const crCheck = check("currentRatio", cr, ">=", T.minCurrentRatio, "ratio");
      const debtCheck = check("longTermDebt", ltd.value, "<=", nwc, "currency");
      return makeRule("D2", S, {
        formula,
        inputs: [
          input("currentAssets", ca, "currency", L),
          input("currentLiabilities", cl, "currency", L),
          input("netWorkingCapital", nwc === null ? null : { value: nwc, note: "derived" }, "currency", L),
          input("longTermDebt", ltd, "currency", L),
        ],
        checks: [crCheck, debtCheck],
        reason: (s) =>
          s === "PASS"
            ? "strongCondition"
            : s === "FAIL"
              ? crCheck.passed === false && debtCheck.passed === false
                ? "bothConditionsFailed"
                : crCheck.passed === false
                  ? "currentRatioTooLow"
                  : "debtExceedsWorkingCapital"
              : zeroDenominator
                ? "zeroDenominator"
                : cr === null
                  ? "missingCurrentItems"
                  : "missingLongTermDebt",
        assumptions: ["X-CR", "X-NWC", ...(ltd.note === "inferredAbsent" ? ["AI-LTD"] : [])],
        sources: filingSources(ctx, [L]),
        period: fyLabel(ctx, L),
      });
    });
  }

  // D3 — earnings stability, ten years
  push("D3", () => earningsStabilityRule(ctx, "D3", S, T.earningsStabilityYears));

  // D4 — twenty-year dividend record
  push("D4", () => {
    const n = T.dividendRecordYears;
    const formula = `Dividend(y) > 0  ∀ y ∈ [Y−${n - 1}, Y]`;
    if (L === null) return noFinancials("D4", S, formula);
    const ev = dividendEvidence(ctx.inputs, ctx.annual);
    const window = yearsBack(L, n);
    let consecutive = 0;
    for (let y = L; y > L - n; y--) {
      if (ev.paid.has(y)) consecutive++;
      else break;
    }
    const gaps = window.filter((y) => ev.covered.has(y) && !ev.paid.has(y));
    const unknown = window.filter((y) => !ev.covered.has(y) && !ev.paid.has(y));
    const coveredInWindow = window.filter((y) => ev.covered.has(y) || ev.paid.has(y)).length;
    return makeRule("D4", S, {
      formula,
      inputs: [
        input("consecutiveDividendYears", consecutive, "count"),
        input("yearsWithEvidence", coveredInWindow, "count"),
        input("excludedDistributions", ev.screen.excluded.length, "count"),
      ],
      checks: [check("consecutiveDividendYears", consecutive, ">=", n, "count", gaps.length > 0 ? false : window.every((y) => ev.paid.has(y)) ? true : null)],
      reason: (s) => (s === "PASS" ? "uninterruptedDividends" : s === "FAIL" ? "dividendGapFound" : "dividendHistoryTooShort"),
      reasonParams: { gapYears: gaps.join(", ") || "—", unknownYears: unknown.length ? `FY${unknown[0]}–FY${unknown[unknown.length - 1]}` : "—", years: n },
      assumptions: ["AI-FY-WINDOW", "AI-DIV-FY", "AI-DIV-COVERAGE", "AI-DIST-FILTER"],
      sources: [
        ...(ctx.inputs.dividends ? [{ kind: "DIVIDENDS" as const, label: ctx.inputs.dividendSourceName ?? "Dividends", period: ctx.inputs.priceHistoryRange ? `${ctx.inputs.priceHistoryRange.first} → ${ctx.inputs.priceHistoryRange.last}` : null, url: null }] : []),
        ...filingSources(ctx, window.filter((y) => ctx.map.get(y)?.values.dividendsPerShare !== undefined)),
      ],
      period: periodLabel(ctx, window),
    });
  });

  // D5 — earnings growth ≥ 1/3 over ten years, three-year averages
  push("D5", () => {
    const formula = "avgEPS(Y−2..Y) / avgEPS(Y−9..Y−7) − 1 ≥ 1/3";
    if (L === null) return noFinancials("D5", S, formula);
    const startYears = [L - 9, L - 8, L - 7];
    const endYears = [L - 2, L - 1, L];
    const start = avgEps(ctx, startYears);
    const end = avgEps(ctx, endYears);
    const growth = start !== null && end !== null && start > 0 ? end / start - 1 : null;
    let passed: boolean | null | undefined;
    let reason = "comparedGrowth";
    if (start === null || end === null) reason = "historyTooShort";
    else if (start <= 0) {
      passed = end <= start ? false : null;
      reason = passed === false ? "noGrowthFromNonPositiveBase" : "growthUndefinedNonPositiveBase";
    }
    return makeRule("D5", S, {
      formula,
      inputs: [...epsInputs(ctx, startYears), ...epsInputs(ctx, endYears), input("startAverageEps", start, "perShare"), input("endAverageEps", end, "perShare")],
      checks: [check("growth", growth, ">=", T.minEarningsGrowth, "percent", passed)],
      reason,
      assumptions: ["AI-FY-WINDOW", "AI-EPS", "X-AVG3", "AI-D5-BASE"],
      sources: filingSources(ctx, [...startYears, ...endYears].filter((y) => ctx.map.has(y))),
      period: periodLabel(ctx, [...startYears, ...endYears]),
    });
  });

  // D6 — price ≤ 15 × three-year average EPS
  const avg3Years = L === null ? [] : [L - 2, L - 1, L];
  const avg3 = L === null ? null : avgEps(ctx, avg3Years);
  const pe3 = ctx.price !== null && avg3 !== null && avg3 > 0 ? ctx.price / avg3 : null;
  push("D6", () => {
    const formula = "Price / avgEPS(Y−2..Y) ≤ 15";
    if (L === null) return noFinancials("D6", S, formula);
    const nonPositive = avg3 !== null && avg3 <= 0;
    return makeRule("D6", S, {
      formula,
      inputs: [input("price", ctx.price, "perShare"), ...epsInputs(ctx, avg3Years), input("averageEps3y", avg3, "perShare")],
      checks: [check("pe3y", pe3, "<=", T.maxPeOnThreeYearAverage, "multiple", nonPositive && ctx.price !== null ? false : undefined)],
      reason: (s) => (s !== "INSUFFICIENT_DATA" ? (nonPositive ? "nonPositiveEarnings" : "comparedPe") : ctx.priceReason ?? "historyTooShort"),
      assumptions: ["AI-PRICE", "AI-EPS", "X-AVG3"],
      sources: [...priceSources(ctx), ...filingSources(ctx, avg3Years.filter((y) => ctx.map.has(y)))],
      period: periodLabel(ctx, avg3Years),
    });
  });

  // D7 — P/B ≤ 1.5, or P/E × P/B ≤ 22.5 (does not replace D6)
  push("D7", () => {
    const formula = "P/B ≤ 1.5  ∨  (P/E₃ × P/B) ≤ 22.5";
    if (L === null) return noFinancials("D7", S, formula);
    const b = perShareBook(ctx);
    const pb = ctx.price !== null && b.bvps !== null && b.bvps > 0 ? ctx.price / b.bvps : null;
    const product = pb !== null && pe3 !== null ? pb * pe3 : null;
    const badBook = b.bvps !== null && b.bvps <= 0;
    const badEarnings = avg3 !== null && avg3 <= 0;
    const pbCheck = check("priceToBook", pb, "<=", T.maxPriceToBook, "multiple", badBook && ctx.price !== null ? false : undefined);
    const productCheck = check("peTimesPb", product, "<=", T.maxPeTimesPb, "ratio", (badBook || badEarnings) && ctx.price !== null ? false : undefined);
    return makeRule("D7", S, {
      formula,
      combinator: "ANY",
      inputs: [
        input("price", ctx.price, "perShare"),
        input("stockholdersEquity", b.parentEquity, "currency", L),
        input("preferredStock", b.pref, "currency", L),
        input("sharesOutstanding", b.shares, "shares", L),
        input("bookValuePerShare", b.bvps, "perShare", L),
        input("pe3y", pe3, "multiple"),
      ],
      checks: [pbCheck, productCheck],
      reason: (s) =>
        s === "PASS"
          ? pbCheck.passed
            ? "pbWithinLimit"
            : "passedByProduct"
          : s === "FAIL"
            ? badBook
              ? "nonPositiveBookValue"
              : "bothAssetTestsFailed"
            : ctx.priceReason ?? (b.bvps === null ? "missingBookValue" : "historyTooShort"),
      assumptions: ["AI-PRICE", "AI-TANGIBLE", "AI-SHARES", "X-PEPB"],
      sources: [...priceSources(ctx), ...filingSources(ctx, [...new Set([...avg3Years, L])].filter((y) => ctx.map.has(y)))],
      period: fyLabel(ctx, L),
    });
  });

  return summarize(S, rules, cls);
}

// ──────────────────────────────── Enterprising (Ch. 15) ────────────────────────────────

export function evaluateEnterprising(inputs: GrahamInputs, options: { earningsGrowthLookbackYears?: number } = {}): ScreenResult {
  return enterprisingFromContext(buildContext({ ...inputs, enterprisingLookbackYears: options.earningsGrowthLookbackYears ?? inputs.enterprisingLookbackYears }));
}

export function enterprisingFromContext(ctx: EvalContext): ScreenResult {
  const T = ENTERPRISING_THRESHOLDS;
  const cls = ctx.classification.industryClass;
  const S: ScreenKind = "ENTERPRISING";
  const L = ctx.lastYear;
  const lookback = ctx.inputs.enterprisingLookbackYears ?? T.earningsGrowthLookbackYears;
  const rules: RuleResult[] = [];
  const push = (id: string, build: () => RuleResult) => rules.push(isApplicable(cls, id) ? build() : notApplicable(id, S, cls));

  // E1 — current ratio ≥ 1.5
  push("E1", () => currentRatioRule(ctx, "E1", S, T.minCurrentRatio));

  // E2 — total debt ≤ 110% of net current assets
  push("E2", () => {
    const formula = "TotalDebt ≤ 1.1 × (CA − CL)";
    if (L === null) return noFinancials("E2", S, formula);
    const { ca, cl, nwc } = currentRatioParts(ctx);
    const ltd = longTermDebtNoted(ctx.last);
    const cur = currentDebtNoted(ctx.last, ctx.provenance.get(L)?.concepts?.debtCurrent);
    const limit = nwc === null ? null : T.maxDebtToNetCurrentAssets * nwc;
    const exact = ltd.value !== null && cur.value !== null && cur.note !== "lowerBound";
    const total = ltd.value !== null && cur.value !== null ? ltd.value + cur.value : ltd.value;
    let passed: boolean | null = null;
    if (limit !== null && ltd.value !== null) {
      if (exact) passed = total! <= limit;
      else if (total! > limit) passed = false; // lower bound already exceeds the limit
    }
    const totalNoted: Noted = { value: total, note: total === null ? "missing" : exact ? "derived" : "lowerBound" };
    return makeRule("E2", S, {
      formula,
      inputs: [
        input("currentAssets", ca, "currency", L),
        input("currentLiabilities", cl, "currency", L),
        input("netCurrentAssets", nwc === null ? null : { value: nwc, note: "derived" }, "currency", L),
        input("longTermDebt", ltd, "currency", L),
        input("currentDebt", cur, "currency", L),
        input("totalDebt", totalNoted, "currency", L),
        input("debtToNetCurrentAssets", total !== null && nwc !== null && nwc > 0 ? total / nwc : null, "ratio"),
      ],
      checks: [check("totalDebt", total, "<=", limit, "currency", passed)],
      reason: (s) =>
        s === "PASS" ? "debtWithinLimit" : s === "FAIL" ? (nwc !== null && nwc <= 0 ? "nonPositiveWorkingCapital" : "debtExceedsLimit") : nwc === null ? "missingCurrentItems" : ltd.value === null ? "missingLongTermDebt" : "missingCurrentDebt",
      assumptions: ["X-NWC", "AI-TOTAL-DEBT", ...(ltd.note === "inferredAbsent" ? ["AI-LTD"] : [])],
      sources: filingSources(ctx, [L]),
      period: fyLabel(ctx, L),
    });
  });

  // E3 — no deficit in five years
  push("E3", () => earningsStabilityRule(ctx, "E3", S, T.earningsStabilityYears));

  // E4 — some current dividend
  push("E4", () => {
    const formula = "Σ Dividends(ex-date ∈ (P−365d, P]) > 0";
    const asOf = ctx.inputs.price?.date ?? ctx.inputs.priceHistoryRange?.last ?? null;
    const ev = dividendEvidence(ctx.inputs, ctx.annual);
    let count: number | null = null;
    let passed: boolean | null = null;
    let reason = "currentDividendUnknown";
    if (ctx.inputs.dividends && asOf) {
      const recent = dividendsInWindow(ev.screen.kept, asOf);
      count = recent.length;
      const range = ctx.inputs.priceHistoryRange;
      const windowStart = new Date(Date.parse(asOf) - 365 * 86_400_000).toISOString().slice(0, 10);
      if (count > 0) {
        passed = true;
        reason = "currentDividendPaid";
      } else if (range && range.first <= windowStart && range.last >= asOf) {
        passed = false;
        reason = "noCurrentDividend";
      }
    }
    if (passed === null && L !== null) {
      // Fallback evidence: the latest 10-K's dividends, if that fiscal year ended within the last year.
      const lastEnd = ctx.last!.periodEnd;
      const recentFy = !asOf || Date.parse(asOf) - Date.parse(lastEnd) <= 365 * 86_400_000;
      if (recentFy && ev.paid.has(L)) {
        passed = true;
        reason = "currentDividendPaid";
      } else if (!ctx.inputs.dividends && ev.covered.has(L) && !ev.paid.has(L)) {
        passed = false;
        reason = "noCurrentDividend";
      }
    }
    return makeRule("E4", S, {
      formula,
      inputs: [input("dividendsLast12m", count, "count"), input("excludedDistributions", ev.screen.excluded.length, "count")],
      checks: [check("dividendsLast12m", count, ">", 0, "count", passed)],
      reason,
      reasonParams: { asOf: asOf ?? "—" },
      assumptions: ["AI-CURRENT-DIV", "AI-DIST-FILTER"],
      sources: [
        ...(ctx.inputs.dividends ? [{ kind: "DIVIDENDS" as const, label: ctx.inputs.dividendSourceName ?? "Dividends", period: asOf, url: null }] : []),
        ...(L !== null ? filingSources(ctx, [L]) : []),
      ],
      period: asOf,
    });
  });

  // E5 — EPS(Y) > EPS(Y − 5)
  push("E5", () => {
    const formula = `EPS(Y) > EPS(Y−${lookback})`;
    if (L === null) return noFinancials("E5", S, formula);
    const now = eps(ctx.map.get(L));
    const then = eps(ctx.map.get(L - lookback));
    return makeRule("E5", S, {
      formula,
      inputs: [input("latestEps", now, "perShare", L), input("baseEps", then, "perShare", L - lookback)],
      checks: [check("latestEps", now, ">", then, "perShare")],
      reason: (s) => (s === "INSUFFICIENT_DATA" ? "historyTooShort" : "comparedGrowth"),
      reasonParams: { lookback },
      assumptions: ["AI-EPS", "AI-E5-EPS"],
      sources: filingSources(ctx, [L, L - lookback].filter((y) => ctx.map.has(y))),
      period: periodLabel(ctx, [L - lookback, L]),
    });
  });

  // E6 — price ≤ 120% of 9 × average earnings (UNVERIFIED definition)
  const avgYears = L === null ? [] : [L - 2, L - 1, L];
  const avg3 = L === null ? null : avgEps(ctx, avgYears);
  push("E6", () => {
    const formula = "Price ≤ 1.2 × (9 × avgEPS(Y−2..Y))  =  10.8 × avgEPS";
    if (L === null) return noFinancials("E6", S, formula);
    const value = avg3 === null ? null : T.earningsMultiplier * avg3;
    const limit = value === null ? null : T.maxPriceToEarningsValue * value;
    const nonPositive = avg3 !== null && avg3 <= 0;
    return makeRule("E6", S, {
      formula,
      inputs: [input("price", ctx.price, "perShare"), ...epsInputs(ctx, avgYears), input("averageEps3y", avg3, "perShare"), input("earningsValue9x", value, "perShare")],
      checks: [check("price", ctx.price, "<=", limit, "perShare", nonPositive && ctx.price !== null ? false : undefined)],
      reason: (s) => (s !== "INSUFFICIENT_DATA" ? (nonPositive ? "nonPositiveEarnings" : "comparedEarningsValue") : ctx.priceReason ?? "historyTooShort"),
      assumptions: ["AI-PRICE", "AI-E6-AVERAGE", "X-AVG3", "X-E6"],
      sources: [...priceSources(ctx), ...filingSources(ctx, avgYears.filter((y) => ctx.map.has(y)))],
      period: periodLabel(ctx, avgYears),
    });
  });

  // E7 — price < 120% of net tangible assets per share
  push("E7", () => {
    const formula = "Price / NTAPS < 1.2,  NTAPS = (Equity − Preferred − Goodwill − Intangibles) / Shares";
    if (L === null) return noFinancials("E7", S, formula);
    const b = perShareBook(ctx);
    const ratioToTangible = ctx.price !== null && b.tbvps !== null && b.tbvps > 0 ? ctx.price / b.tbvps : null;
    const badTangible = b.tbvps !== null && b.tbvps <= 0;
    return makeRule("E7", S, {
      formula,
      inputs: [
        input("price", ctx.price, "perShare"),
        input("stockholdersEquity", b.parentEquity, "currency", L),
        input("preferredStock", b.pref, "currency", L),
        input("goodwill", b.goodwill, "currency", L),
        input("intangibleAssets", b.intangibles, "currency", L),
        input("sharesOutstanding", b.shares, "shares", L),
        input("tangibleBookValuePerShare", b.tbvps, "perShare", L),
      ],
      checks: [check("priceToTangibleBook", ratioToTangible, "<", T.maxPriceToNetTangibleAssets, "multiple", badTangible && ctx.price !== null ? false : undefined)],
      reason: (s) => (s !== "INSUFFICIENT_DATA" ? (badTangible ? "nonPositiveTangibleBook" : "comparedTangible") : ctx.priceReason ?? "missingBookValue"),
      assumptions: ["AI-PRICE", "AI-TANGIBLE", "AI-SHARES"],
      sources: [...priceSources(ctx), ...filingSources(ctx, [L])],
      period: fyLabel(ctx, L),
    });
  });

  return summarize(S, rules, cls);
}

// ─────────────────────────────── summary ───────────────────────────────

export function summarize(screen: ScreenKind, rules: RuleResult[], industryClass: IndustryClass): ScreenResult {
  const counted = rules.filter((r) => r.counted);
  const passed = counted.filter((r) => r.status === "PASS").length;
  const failed = counted.filter((r) => r.status === "FAIL").length;
  const insufficient = counted.filter((r) => r.status === "INSUFFICIENT_DATA").length;
  const notApplicableCount = counted.filter((r) => r.status === "NOT_APPLICABLE").length;
  const applicable = counted.length - notApplicableCount;
  const outcome: ScreenOutcome =
    applicable === 0 ? "NOT_APPLICABLE" : failed > 0 ? "FAILS_ONE_OR_MORE" : insufficient > 0 ? "INCOMPLETE_DATA" : "MEETS_ALL";
  const ruleSet = applicable === 0 ? "NONE" : industryClass === "INDUSTRIAL" ? "FULL" : "SPECIALIZED";
  return {
    screen,
    engineVersion: GRAHAM_ENGINE_VERSION,
    methodology: "GRAHAM_1973",
    outcome,
    ruleSet,
    passed,
    failed,
    insufficient,
    notApplicable: notApplicableCount,
    unverifiedCounted: counted.filter((r) => r.verification === "UNVERIFIED" && r.status !== "NOT_APPLICABLE").length,
    rules,
  };
}

export { isFinancialEnterprise };

/** A rule's computed value by key: a check's actual value first, then an input (null when absent). */
export function ruleValue(rule: RuleResult | undefined, key: string): Num {
  if (!rule) return null;
  const c = rule.checks.find((x) => x.key === key);
  if (c) return c.actual;
  const i = rule.inputs.find((x) => x.key === key);
  return i ? i.value : null;
}

export function findRule(screen: ScreenResult, id: string): RuleResult | undefined {
  return screen.rules.find((r) => r.id === id);
}
