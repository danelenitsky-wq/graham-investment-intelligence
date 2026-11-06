/**
 * Latest-quarter and trailing-twelve-month (TTM) financial health (pure).
 *
 * This is NOT part of Graham's method. Graham's rules in src/lib/graham are
 * applied to annual statements only, and they stay that way. This module is
 * an application-defined freshness check: it looks at what the 10-Q filings
 * published after the latest annual report say, so a user can see when the
 * business has deteriorated materially since the annual figures that the
 * Graham screens are based on.
 *
 * TTM for flow items (revenue, income, cash flow):
 *   ANNUAL_PLUS_YTD: latest annual + quarters reported since − the same quarters a year earlier
 *   FOUR_QUARTERS:   sum of the four latest consecutive discrete quarters
 *   ANNUAL:          no quarter has been reported since the annual filing, TTM = annual
 * Missing components make the TTM value null; nothing is estimated.
 * Balance-sheet items are taken as of the latest quarter end.
 */
import { commonEquity, currentRatio, longTermDebt, netCurrentAssets, type Num } from "@/lib/graham/metrics";
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import { daysBetween, type AnnualFinancials } from "@/lib/normalization/statements";

export const INTERIM_ENGINE_VERSION = "interim-1.0.0";

export interface QuarterInput {
  fiscalYear: number;
  fiscalPeriod: string;
  periodEnd: string;
  currency: string;
  filedAt: string | null;
  form: string | null;
  accessionNumber: string | null;
  values: Partial<Record<CanonicalConcept, number>>;
}

/**
 * Thresholds for "material deterioration". Application-defined, not from
 * Graham. Changes are expressed as fractions (0.1 = 10%).
 */
export const DETERIORATION_THRESHOLDS = {
  revenueDecline: 0.1,
  operatingIncomeDecline: 0.25,
  netIncomeDecline: 0.25,
  epsDecline: 0.25,
  operatingCashFlowDecline: 0.25,
  currentRatioDecline: 0.2,
  workingCapitalDecline: 0.2,
  debtIncrease: 0.25,
  equityDecline: 0.15,
  /** The current-ratio level Graham's defensive rule uses on ANNUAL data; here only a reference level. */
  currentRatioReference: 2,
} as const;

export type TtmMethod = "ANNUAL_PLUS_YTD" | "FOUR_QUARTERS" | "ANNUAL";

export const TTM_FLOW_METRICS = ["revenue", "operatingIncome", "netIncome", "epsDiluted", "operatingCashFlow"] as const;
export type TtmFlowMetric = (typeof TTM_FLOW_METRICS)[number];
export const BALANCE_METRICS = ["currentRatio", "workingCapital", "totalDebt", "commonEquity", "cashAndEquivalents"] as const;
export type BalanceMetric = (typeof BALANCE_METRICS)[number];
export type InterimMetric = TtmFlowMetric | BalanceMetric;

export interface MetricComparison {
  metric: InterimMetric;
  kind: "TTM" | "LATEST_QUARTER";
  /** Value from the latest annual report. */
  annual: Num;
  /** TTM value (flows) or latest-quarter value (balance sheet). */
  latest: Num;
  /** (latest − annual) / |annual|; null when not meaningful (missing, or annual ≤ 0 for flows). */
  change: Num;
  method: TtmMethod | null;
  /** Per-share TTM is a sum of quarterly per-share figures (approximate when the share count changed). */
  approximate: boolean;
}

export type DeteriorationCode =
  | "REVENUE_DECLINE"
  | "OPERATING_INCOME_DECLINE"
  | "OPERATING_INCOME_TURNED_NEGATIVE"
  | "NET_INCOME_DECLINE"
  | "NET_INCOME_TURNED_NEGATIVE"
  | "EPS_DECLINE"
  | "EPS_TURNED_NEGATIVE"
  | "OPERATING_CASH_FLOW_DECLINE"
  | "OPERATING_CASH_FLOW_TURNED_NEGATIVE"
  | "CURRENT_RATIO_DECLINE"
  | "CURRENT_RATIO_BELOW_REFERENCE"
  | "WORKING_CAPITAL_DECLINE"
  | "WORKING_CAPITAL_TURNED_NEGATIVE"
  | "DEBT_INCREASE"
  | "EQUITY_DECLINE"
  | "EQUITY_TURNED_NEGATIVE";

export interface DeteriorationFlag {
  code: DeteriorationCode;
  metric: InterimMetric;
  annual: number;
  latest: number;
  change: Num;
  /** Threshold that was crossed (fraction, or a level for CURRENT_RATIO_BELOW_REFERENCE). */
  threshold: number | null;
}

export type InterimStatus =
  | "NO_ANNUAL" // no annual statements to compare with
  | "NO_QUARTERS" // no quarterly statements stored
  | "ANNUAL_IS_LATEST" // nothing reported since the latest annual period
  | "CURRENCY_MISMATCH" // quarterly and annual statements use different currencies
  | "OK";

export interface InterimHealth {
  version: string;
  status: InterimStatus;
  latestAnnual: { fiscalYear: number; periodEnd: string; currency: string } | null;
  latestQuarter: { fiscalYear: number; fiscalPeriod: string; periodEnd: string; filedAt: string | null; form: string | null; accessionNumber: string | null } | null;
  /** Quarters reported after the latest annual period end. */
  quartersSinceAnnual: number;
  ttmPeriodEnd: string | null;
  comparisons: MetricComparison[];
  flags: DeteriorationFlag[];
  materialDeterioration: boolean;
}

const QUARTER_MIN_DAYS = 80;
const QUARTER_MAX_DAYS = 100;
const YEAR_TOLERANCE_DAYS = 10;

function isQuarterGap(a: string, b: string): boolean {
  const d = daysBetween(a, b);
  return d >= QUARTER_MIN_DAYS && d <= QUARTER_MAX_DAYS;
}

/** The quarter ending about one year before `q` (52/53-week years tolerated). */
function yearEarlier(quarters: QuarterInput[], q: QuarterInput): QuarterInput | null {
  let best: QuarterInput | null = null;
  let bestDist = Infinity;
  for (const p of quarters) {
    const dist = Math.abs(daysBetween(p.periodEnd, q.periodEnd) - 365);
    if (dist <= YEAR_TOLERANCE_DAYS && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

function sum(values: (number | undefined)[]): Num {
  if (values.some((v) => v === undefined || !Number.isFinite(v))) return null;
  return (values as number[]).reduce((s, v) => s + v, 0);
}

function ttmFlow(metric: TtmFlowMetric, annual: AnnualFinancials, quarters: QuarterInput[], since: QuarterInput[]): { value: Num; method: TtmMethod | null } {
  if (since.length === 0) return { value: annual.values[metric] ?? null, method: "ANNUAL" };
  // Annual + year-to-date − prior-year year-to-date, when the quarters since the annual are consecutive.
  if (since.length <= 3 && isQuarterGap(annual.periodEnd, since[0].periodEnd) && since.every((q, i) => i === 0 || isQuarterGap(since[i - 1].periodEnd, q.periodEnd))) {
    const prior = since.map((q) => yearEarlier(quarters, q));
    const a = annual.values[metric];
    if (a !== undefined && prior.every((p) => p !== null)) {
      const ytd = sum(since.map((q) => q.values[metric]));
      const priorYtd = sum(prior.map((p) => p!.values[metric]));
      if (ytd !== null && priorYtd !== null) return { value: a + ytd - priorYtd, method: "ANNUAL_PLUS_YTD" };
    }
  }
  // Four latest consecutive discrete quarters.
  const last4 = quarters.slice(-4);
  if (last4.length === 4 && last4.every((q, i) => i === 0 || isQuarterGap(last4[i - 1].periodEnd, q.periodEnd))) {
    const s = sum(last4.map((q) => q.values[metric]));
    if (s !== null) return { value: s, method: "FOUR_QUARTERS" };
  }
  return { value: null, method: null };
}

type Shape = Pick<AnnualFinancials, "fiscalYear" | "periodEnd" | "currency" | "values">;

/** Total debt: long-term debt plus current portion and short-term borrowings (absent current items count as none). */
function totalDebt(a: Shape): Num {
  const ltd = longTermDebt(a);
  if (ltd === null) return null;
  return ltd + (a.values.debtCurrent ?? 0) + (a.values.shortTermBorrowings ?? 0);
}

function balance(metric: BalanceMetric, a: Shape): Num {
  switch (metric) {
    case "currentRatio":
      return currentRatio(a);
    case "workingCapital":
      return netCurrentAssets(a);
    case "totalDebt":
      return totalDebt(a);
    case "commonEquity":
      return commonEquity(a);
    case "cashAndEquivalents":
      return a.values.cashAndEquivalents ?? null;
  }
}

function relChange(annual: Num, latest: Num, requirePositiveBase: boolean): Num {
  if (annual === null || latest === null) return null;
  if (requirePositiveBase ? annual <= 0 : annual === 0) return null;
  return (latest - annual) / Math.abs(annual);
}

export function computeInterimHealth(annualIn: AnnualFinancials[], quartersIn: QuarterInput[], thresholds = DETERIORATION_THRESHOLDS): InterimHealth {
  const annualSorted = [...annualIn].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const annual = annualSorted[annualSorted.length - 1] ?? null;
  // One row per quarter end, ascending.
  const byEnd = new Map<string, QuarterInput>();
  for (const q of quartersIn) if (!byEnd.has(q.periodEnd)) byEnd.set(q.periodEnd, q);
  const quarters = [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const lastQ = quarters[quarters.length - 1] ?? null;

  const base: InterimHealth = {
    version: INTERIM_ENGINE_VERSION,
    status: "OK",
    latestAnnual: annual ? { fiscalYear: annual.fiscalYear, periodEnd: annual.periodEnd, currency: annual.currency } : null,
    latestQuarter: lastQ ? { fiscalYear: lastQ.fiscalYear, fiscalPeriod: lastQ.fiscalPeriod, periodEnd: lastQ.periodEnd, filedAt: lastQ.filedAt, form: lastQ.form, accessionNumber: lastQ.accessionNumber } : null,
    quartersSinceAnnual: 0,
    ttmPeriodEnd: null,
    comparisons: [],
    flags: [],
    materialDeterioration: false,
  };
  if (!annual) return { ...base, status: "NO_ANNUAL" };
  if (!lastQ) return { ...base, status: "NO_QUARTERS" };
  if (quarters.some((q) => q.currency !== annual.currency)) return { ...base, status: "CURRENCY_MISMATCH" };

  const since = quarters.filter((q) => q.periodEnd > annual.periodEnd);
  if (since.length === 0) return { ...base, status: "ANNUAL_IS_LATEST", ttmPeriodEnd: annual.periodEnd };

  const comparisons: MetricComparison[] = [];
  for (const m of TTM_FLOW_METRICS) {
    const { value, method } = ttmFlow(m, annual, quarters, since);
    const a = annual.values[m] ?? null;
    comparisons.push({ metric: m, kind: "TTM", annual: a, latest: value, change: relChange(a, value, true), method, approximate: m === "epsDiluted" && method !== "ANNUAL" });
  }
  for (const m of BALANCE_METRICS) {
    const a = balance(m, annual);
    const l = balance(m, lastQ);
    comparisons.push({ metric: m, kind: "LATEST_QUARTER", annual: a, latest: l, change: relChange(a, l, m !== "totalDebt"), method: null, approximate: false });
  }

  const flags: DeteriorationFlag[] = [];
  const get = (m: InterimMetric) => comparisons.find((c) => c.metric === m)!;
  const push = (code: DeteriorationCode, c: MetricComparison, threshold: number | null) => flags.push({ code, metric: c.metric, annual: c.annual!, latest: c.latest!, change: c.change, threshold });
  const flow = (m: TtmFlowMetric, decline: number, declineCode: DeteriorationCode, negativeCode: DeteriorationCode | null) => {
    const c = get(m);
    if (c.annual === null || c.latest === null) return;
    if (negativeCode && c.annual > 0 && c.latest <= 0) push(negativeCode, c, 0);
    else if (c.change !== null && c.change <= -decline) push(declineCode, c, decline);
  };
  flow("revenue", thresholds.revenueDecline, "REVENUE_DECLINE", null);
  flow("operatingIncome", thresholds.operatingIncomeDecline, "OPERATING_INCOME_DECLINE", "OPERATING_INCOME_TURNED_NEGATIVE");
  flow("netIncome", thresholds.netIncomeDecline, "NET_INCOME_DECLINE", "NET_INCOME_TURNED_NEGATIVE");
  flow("epsDiluted", thresholds.epsDecline, "EPS_DECLINE", "EPS_TURNED_NEGATIVE");
  flow("operatingCashFlow", thresholds.operatingCashFlowDecline, "OPERATING_CASH_FLOW_DECLINE", "OPERATING_CASH_FLOW_TURNED_NEGATIVE");

  const cr = get("currentRatio");
  if (cr.annual !== null && cr.latest !== null) {
    if (cr.annual >= thresholds.currentRatioReference && cr.latest < thresholds.currentRatioReference) push("CURRENT_RATIO_BELOW_REFERENCE", cr, thresholds.currentRatioReference);
    else if (cr.change !== null && cr.change <= -thresholds.currentRatioDecline) push("CURRENT_RATIO_DECLINE", cr, thresholds.currentRatioDecline);
  }
  const wc = get("workingCapital");
  if (wc.annual !== null && wc.latest !== null) {
    if (wc.annual > 0 && wc.latest <= 0) push("WORKING_CAPITAL_TURNED_NEGATIVE", wc, 0);
    else if (wc.change !== null && wc.change <= -thresholds.workingCapitalDecline) push("WORKING_CAPITAL_DECLINE", wc, thresholds.workingCapitalDecline);
  }
  const debt = get("totalDebt");
  if (debt.annual !== null && debt.latest !== null && debt.latest > 0) {
    // From zero debt to some debt counts as an increase beyond any threshold.
    if (debt.annual === 0 || (debt.change !== null && debt.change >= thresholds.debtIncrease)) push("DEBT_INCREASE", debt, thresholds.debtIncrease);
  }
  const eq = get("commonEquity");
  if (eq.annual !== null && eq.latest !== null) {
    if (eq.annual > 0 && eq.latest <= 0) push("EQUITY_TURNED_NEGATIVE", eq, 0);
    else if (eq.change !== null && eq.change <= -thresholds.equityDecline) push("EQUITY_DECLINE", eq, thresholds.equityDecline);
  }

  return {
    ...base,
    quartersSinceAnnual: since.length,
    ttmPeriodEnd: lastQ.periodEnd,
    comparisons,
    flags,
    materialDeterioration: flags.length > 0,
  };
}
