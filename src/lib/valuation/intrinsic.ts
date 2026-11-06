/**
 * OPTIONAL CONSERVATIVE INTRINSIC VALUE — a MODERN ANALYTICAL EXTENSION.
 *
 * Neither model below is an original Graham screening rule. They are offered
 * so that a margin of safety can be measured against an explicit, user-owned
 * estimate of value instead of against a screening limit (the Graham Number
 * and the other price ceilings are never treated as intrinsic value).
 *
 *  - DCF: revenue × margin → per-share earnings (diluted each year), projected
 *    N years, discounted, plus a Gordon terminal value.
 *  - NORMALIZED_EARNINGS: average EPS over the normalization window,
 *    capitalised as a growing perpetuity (terminal growth net of dilution).
 *
 * Every assumption is visible and user-configurable. Defaults are derived from
 * the company's own history and deliberately tilted conservative (growth is
 * capped, buybacks are not assumed to continue, the normalized
 * net-income margin is used, with free cash flow as a cross-check). When the inputs cannot support a value
 * the result is NOT_ESTABLISHED; nothing is filled in.
 *
 * Pure and dependency-free so the same code runs on the server and live in the
 * browser while the user moves the assumption sliders.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";
import type { IndustryClass } from "@/lib/graham/classification";

type Num = number | null;

export const INTRINSIC_MODEL_VERSION = "1.0.0";

export type IntrinsicMethod = "DCF" | "NORMALIZED_EARNINGS";

export interface IntrinsicAssumptions {
  enabled: boolean;
  method: IntrinsicMethod;
  /** Annual revenue growth over the projection period (decimal, 0.05 = 5%). DCF only. */
  revenueGrowth: number;
  /** Net profit margin applied to projected revenue (decimal). DCF only. */
  profitMargin: number;
  /** Annual discount rate (required return), decimal. */
  discountRate: number;
  /** Perpetual growth after the projection period (decimal). Must be below the discount rate. */
  terminalGrowth: number;
  /** Fiscal years averaged for the normalized margin / EPS and the historical defaults (3–10). */
  normalizationYears: number;
  /** Annual growth of the share count (decimal; 0.01 = 1% dilution per year). */
  shareDilution: number;
  /** Explicit projection years before the terminal value (DCF). */
  projectionYears: number;
}

export const INTRINSIC_DEFAULTS = {
  discountRate: 0.1,
  terminalGrowth: 0.02,
  normalizationYears: 5,
  projectionYears: 10,
  /**
   * Default revenue growth = the company's own revenue CAGR over the normalization
   * window (5 years by default). Above this it is capped (the input's upper limit).
   */
  maxDefaultRevenueGrowth: 0.3,
  minHistoryYears: 3,
} as const;

/** FCF margin below this fraction of the net-income margin is flagged as heavy investment. */
export const FCF_GAP_FACTOR = 0.5;

export const INTRINSIC_LIMITS = {
  revenueGrowth: [-0.3, 0.3],
  profitMargin: [-0.5, 0.6],
  discountRate: [0.04, 0.25],
  terminalGrowth: [-0.02, 0.04],
  normalizationYears: [3, 10],
  shareDilution: [-0.05, 0.1],
  projectionYears: [5, 15],
} as const;

/** Where each default came from (shown next to the input). */
export type AssumptionSource = "HISTORICAL" | "HISTORICAL_CAPPED" | "APP_DEFAULT" | "USER" | "UNAVAILABLE";

export interface HistoryRow {
  fiscalYear: number;
  revenue: Num;
  netIncome: Num;
  freeCashFlow: Num;
  eps: Num;
  shares: Num;
}

/** Company data the model reads (latest fiscal year and the normalization window). */
export interface IntrinsicBase {
  currency: string | null;
  fiscalYear: number | null;
  industryClass: IndustryClass;
  history: HistoryRow[];
}

export interface AssumptionDefaults {
  assumptions: IntrinsicAssumptions;
  sources: Record<"revenueGrowth" | "profitMargin" | "discountRate" | "terminalGrowth" | "normalizationYears" | "shareDilution" | "projectionYears", AssumptionSource>;
  /** Which margin the default came from. */
  marginBasis: "NET_INCOME" | "FREE_CASH_FLOW" | null;
  /** Normalized FCF margin is below half the net-income margin (heavy investment years): flagged, not used. */
  fcfWellBelowEarnings: boolean;
  historical: { revenueCagr: Num; netMargin: Num; fcfMargin: Num; shareCagr: Num; normalizedEps: Num; years: number[] };
}

export type IntrinsicStatus = "ESTABLISHED" | "NOT_ESTABLISHED" | "DISABLED";

export type IntrinsicReason =
  | "computed"
  | "disabled"
  | "financialIssuer"
  | "insufficientHistory"
  | "missingRevenue"
  | "missingShares"
  | "missingEarnings"
  | "nonPositiveMargin"
  | "nonPositiveNormalizedEarnings"
  | "discountNotAboveTerminal"
  | "nonPositiveValue"
  | "invalidAssumption";

export interface ProjectionRow {
  year: number;
  revenue: number;
  earnings: number;
  shares: number;
  perShare: number;
  discountFactor: number;
  presentValue: number;
}

export interface SensitivityTable {
  rowKey: "discountRate";
  colKey: "revenueGrowth" | "terminalGrowth";
  rows: number[];
  cols: number[];
  /** values[i][j] for rows[i], cols[j]; null when not computable (e.g. r ≤ g). */
  values: Num[][];
  baseRow: number;
  baseCol: number;
}

export interface IntrinsicResult {
  modelVersion: string;
  methodology: "MODERN_EXTENSION";
  status: IntrinsicStatus;
  reason: IntrinsicReason;
  method: IntrinsicMethod;
  /** Base-case per-share value. */
  value: Num;
  /** Valuation range: min/max of the inner sensitivity band (discount rate ±1pp, growth ±1 step). */
  low: Num;
  high: Num;
  assumptions: IntrinsicAssumptions;
  inputs: { baseRevenue: Num; baseShares: Num; normalizedEps: Num };
  projection: ProjectionRow[];
  terminalValuePerShare: Num;
  presentValueOfTerminal: Num;
  /** Share of the value that comes from the terminal value (0–1). */
  terminalShare: Num;
  /** True when more than 75% of the value is in the terminal value: treat with extra caution. */
  terminalHeavy: boolean;
  sensitivity: SensitivityTable | null;
}

// ─────────────────────────────── base data ───────────────────────────────

const val = (n: number | undefined): Num => (n === undefined || !Number.isFinite(n) ? null : n);

function rowEps(a: AnnualFinancials): Num {
  const v = a.values;
  if (v.epsDiluted !== undefined) return v.epsDiluted;
  if (v.epsBasic !== undefined) return v.epsBasic;
  if (v.netIncome !== undefined && v.dilutedShares) return v.netIncome / v.dilutedShares;
  return null;
}

export function buildIntrinsicBase(annual: AnnualFinancials[], industryClass: IndustryClass): IntrinsicBase {
  const sorted = [...annual].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const last = sorted[sorted.length - 1];
  return {
    currency: last?.currency ?? null,
    fiscalYear: last?.fiscalYear ?? null,
    industryClass,
    history: sorted.map((a) => {
      const v = a.values;
      const fcf = v.operatingCashFlow !== undefined && v.capitalExpenditures !== undefined ? v.operatingCashFlow - Math.abs(v.capitalExpenditures) : null;
      return {
        fiscalYear: a.fiscalYear,
        revenue: val(v.revenue),
        netIncome: val(v.netIncome),
        freeCashFlow: fcf,
        eps: rowEps(a),
        shares: val(v.dilutedShares ?? v.sharesOutstanding),
      };
    }),
  };
}

/** The last `n` consecutive fiscal years ending at the latest year (fewer if history is shorter). */
function windowRows(base: IntrinsicBase, n: number): HistoryRow[] {
  if (base.fiscalYear === null) return [];
  const byYear = new Map(base.history.map((h) => [h.fiscalYear, h]));
  const out: HistoryRow[] = [];
  for (let y = base.fiscalYear - n + 1; y <= base.fiscalYear; y++) {
    const r = byYear.get(y);
    if (r) out.push(r);
  }
  return out;
}

function cagrBetween(first: Num, last: Num, years: number): Num {
  if (first === null || last === null || first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

/** Aggregate margin Σ numerator / Σ revenue over rows where both are known (all rows required). */
function aggregateMargin(rows: HistoryRow[], pick: (r: HistoryRow) => Num): Num {
  if (rows.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const x = pick(r);
    if (x === null || r.revenue === null) return null;
    num += x;
    den += r.revenue;
  }
  return den > 0 ? num / den : null;
}

function averageOf(values: Num[]): Num {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((s, v) => s + v, 0) / values.length;
}

export function clampAssumption<K extends keyof typeof INTRINSIC_LIMITS>(key: K, v: number): number {
  const [lo, hi] = INTRINSIC_LIMITS[key];
  return Math.min(hi, Math.max(lo, v));
}

/** Historical figures over the normalization window. */
export function historicalFigures(base: IntrinsicBase, normalizationYears: number) {
  const rows = windowRows(base, normalizationYears);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const span = first && last ? last.fiscalYear - first.fiscalYear : 0;
  return {
    rows,
    revenueCagr: rows.length >= 2 ? cagrBetween(first.revenue, last.revenue, span) : null,
    netMargin: aggregateMargin(rows, (r) => r.netIncome),
    fcfMargin: aggregateMargin(rows, (r) => r.freeCashFlow),
    shareCagr: rows.length >= 2 ? cagrBetween(first.shares, last.shares, span) : null,
    normalizedEps: averageOf(rows.map((r) => r.eps)),
  };
}

/**
 * Conservative defaults derived from the company's own history:
 *  - revenue growth: historical revenue CAGR over the window (5 years by default), capped at 30%
 *  - margin: the normalized net-income margin (FCF margin only when net income is missing;
 *    an FCF margin far below it is flagged, not used)
 *  - dilution: historical share-count growth, floored at 0 (buybacks are not assumed to continue)
 *  - discount rate 10%, terminal growth 2%, 10 projection years: application defaults
 */
export function defaultAssumptions(base: IntrinsicBase, overrides: Partial<Pick<IntrinsicAssumptions, "discountRate" | "terminalGrowth" | "normalizationYears" | "enabled">> = {}): AssumptionDefaults {
  const normalizationYears = overrides.normalizationYears ?? INTRINSIC_DEFAULTS.normalizationYears;
  const h = historicalFigures(base, normalizationYears);
  const sources: AssumptionDefaults["sources"] = {
    revenueGrowth: "APP_DEFAULT",
    profitMargin: "UNAVAILABLE",
    discountRate: overrides.discountRate !== undefined ? "USER" : "APP_DEFAULT",
    terminalGrowth: overrides.terminalGrowth !== undefined ? "USER" : "APP_DEFAULT",
    normalizationYears: overrides.normalizationYears !== undefined ? "USER" : "APP_DEFAULT",
    shareDilution: "APP_DEFAULT",
    projectionYears: "APP_DEFAULT",
  };

  let revenueGrowth = 0;
  if (h.revenueCagr !== null) {
    revenueGrowth = Math.min(h.revenueCagr, INTRINSIC_DEFAULTS.maxDefaultRevenueGrowth);
    sources.revenueGrowth = h.revenueCagr > INTRINSIC_DEFAULTS.maxDefaultRevenueGrowth ? "HISTORICAL_CAPPED" : "HISTORICAL";
  }

  // Margin: normalized NET-INCOME margin (Graham values a business on normalized earnings).
  // Free cash flow is only the fallback when net income is unavailable: in years of heavy
  // growth investment (e.g. data-centre capex) FCF can be a small fraction of earnings,
  // which would value a profitable business at almost nothing. That gap is flagged instead.
  let profitMargin = 0;
  let marginBasis: AssumptionDefaults["marginBasis"] = null;
  if (h.netMargin !== null) {
    [profitMargin, marginBasis] = [h.netMargin, "NET_INCOME"];
    sources.profitMargin = "HISTORICAL";
  } else if (h.fcfMargin !== null) {
    [profitMargin, marginBasis] = [h.fcfMargin, "FREE_CASH_FLOW"];
    sources.profitMargin = "HISTORICAL";
  }
  const fcfWellBelowEarnings = h.netMargin !== null && h.fcfMargin !== null && h.netMargin > 0 && h.fcfMargin < h.netMargin * FCF_GAP_FACTOR;

  let shareDilution = 0;
  if (h.shareCagr !== null) {
    shareDilution = Math.max(0, h.shareCagr);
    sources.shareDilution = "HISTORICAL";
  }

  return {
    assumptions: {
      enabled: overrides.enabled ?? true,
      method: "DCF",
      revenueGrowth: clampAssumption("revenueGrowth", revenueGrowth),
      profitMargin: clampAssumption("profitMargin", profitMargin),
      discountRate: overrides.discountRate ?? INTRINSIC_DEFAULTS.discountRate,
      terminalGrowth: overrides.terminalGrowth ?? INTRINSIC_DEFAULTS.terminalGrowth,
      normalizationYears,
      shareDilution: clampAssumption("shareDilution", shareDilution),
      projectionYears: INTRINSIC_DEFAULTS.projectionYears,
    },
    sources,
    marginBasis,
    fcfWellBelowEarnings,
    historical: { revenueCagr: h.revenueCagr, netMargin: h.netMargin, fcfMargin: h.fcfMargin, shareCagr: h.shareCagr, normalizedEps: h.normalizedEps, years: h.rows.map((r) => r.fiscalYear) },
  };
}

// ─────────────────────────────── models ───────────────────────────────

const FINANCIAL_CLASSES: IndustryClass[] = ["BANK", "INSURANCE", "REIT", "ETF", "OTHER_FINANCIAL"];

interface CoreOutput {
  value: Num;
  reason: IntrinsicReason;
  projection: ProjectionRow[];
  terminalValuePerShare: Num;
  presentValueOfTerminal: Num;
}

function validAssumptions(a: IntrinsicAssumptions): boolean {
  const keys = ["revenueGrowth", "profitMargin", "discountRate", "terminalGrowth", "shareDilution"] as const;
  return keys.every((k) => Number.isFinite(a[k])) && a.discountRate > 0 && a.projectionYears >= 1 && a.normalizationYears >= 1 && a.shareDilution > -1;
}

/** Earnings-based DCF on per-share figures. */
export function dcfValue(baseRevenue: number, baseShares: number, a: IntrinsicAssumptions): CoreOutput {
  const empty = { projection: [], terminalValuePerShare: null, presentValueOfTerminal: null };
  if (a.profitMargin <= 0) return { value: null, reason: "nonPositiveMargin", ...empty };
  if (a.discountRate <= a.terminalGrowth) return { value: null, reason: "discountNotAboveTerminal", ...empty };
  const projection: ProjectionRow[] = [];
  let pv = 0;
  for (let t = 1; t <= a.projectionYears; t++) {
    const revenue = baseRevenue * Math.pow(1 + a.revenueGrowth, t);
    const earnings = revenue * a.profitMargin;
    const shares = baseShares * Math.pow(1 + a.shareDilution, t);
    const perShare = earnings / shares;
    const discountFactor = 1 / Math.pow(1 + a.discountRate, t);
    pv += perShare * discountFactor;
    projection.push({ year: t, revenue, earnings, shares, perShare, discountFactor, presentValue: perShare * discountFactor });
  }
  const lastRow = projection[projection.length - 1];
  // Terminal per-share growth is net of continuing dilution.
  const perShareTerminalGrowth = (1 + a.terminalGrowth) / (1 + a.shareDilution) - 1;
  if (a.discountRate <= perShareTerminalGrowth) return { value: null, reason: "discountNotAboveTerminal", ...empty };
  const terminalValuePerShare = (lastRow.perShare * (1 + perShareTerminalGrowth)) / (a.discountRate - perShareTerminalGrowth);
  const presentValueOfTerminal = terminalValuePerShare * lastRow.discountFactor;
  const value = pv + presentValueOfTerminal;
  if (!(value > 0)) return { value: null, reason: "nonPositiveValue", projection, terminalValuePerShare, presentValueOfTerminal };
  return { value, reason: "computed", projection, terminalValuePerShare, presentValueOfTerminal };
}

/** Normalized earnings capitalised as a growing perpetuity: V = E × (1 + g′) / (r − g′), g′ = terminal growth net of dilution. */
export function normalizedEarningsValue(normalizedEps: number, a: IntrinsicAssumptions): CoreOutput {
  const empty = { projection: [], terminalValuePerShare: null, presentValueOfTerminal: null };
  if (normalizedEps <= 0) return { value: null, reason: "nonPositiveNormalizedEarnings", ...empty };
  const g = (1 + a.terminalGrowth) / (1 + a.shareDilution) - 1;
  if (a.discountRate <= g) return { value: null, reason: "discountNotAboveTerminal", ...empty };
  const value = (normalizedEps * (1 + g)) / (a.discountRate - g);
  return { value, reason: "computed", projection: [], terminalValuePerShare: value, presentValueOfTerminal: value };
}

interface Prepared {
  reason: IntrinsicReason | null;
  baseRevenue: Num;
  baseShares: Num;
  normalizedEps: Num;
}

function prepare(base: IntrinsicBase, a: IntrinsicAssumptions): Prepared {
  const last = base.history[base.history.length - 1];
  const h = historicalFigures(base, a.normalizationYears);
  const out: Prepared = { reason: null, baseRevenue: last?.revenue ?? null, baseShares: last?.shares ?? null, normalizedEps: h.normalizedEps };
  if (!validAssumptions(a)) return { ...out, reason: "invalidAssumption" };
  if (FINANCIAL_CLASSES.includes(base.industryClass)) return { ...out, reason: "financialIssuer" };
  if (h.rows.length < Math.min(INTRINSIC_DEFAULTS.minHistoryYears, a.normalizationYears)) return { ...out, reason: "insufficientHistory" };
  if (a.method === "DCF") {
    if (out.baseRevenue === null || out.baseRevenue <= 0) return { ...out, reason: "missingRevenue" };
    if (out.baseShares === null || out.baseShares <= 0) return { ...out, reason: "missingShares" };
  } else if (out.normalizedEps === null) return { ...out, reason: "missingEarnings" };
  return out;
}

function core(p: Prepared, a: IntrinsicAssumptions): CoreOutput {
  return a.method === "DCF" ? dcfValue(p.baseRevenue!, p.baseShares!, a) : normalizedEarningsValue(p.normalizedEps!, a);
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Sensitivity grid: discount rate (rows, ±1pp steps) × revenue growth (DCF,
 * ±2pp steps) or terminal growth (normalized earnings, ±0.5pp steps).
 */
export function sensitivityAnalysis(base: IntrinsicBase, a: IntrinsicAssumptions, size = 5): SensitivityTable | null {
  const p = prepare(base, a);
  if (p.reason) return null;
  const half = Math.floor(size / 2);
  const colKey = a.method === "DCF" ? "revenueGrowth" : "terminalGrowth";
  const colStep = a.method === "DCF" ? 0.02 : 0.005;
  const rows = Array.from({ length: size }, (_, i) => round6(a.discountRate + (i - half) * 0.01));
  const cols = Array.from({ length: size }, (_, j) => round6(a[colKey] + (j - half) * colStep));
  const values = rows.map((r) =>
    cols.map((c) => {
      if (r <= 0) return null;
      const out = core(p, { ...a, discountRate: r, [colKey]: c });
      return out.value;
    }),
  );
  return { rowKey: "discountRate", colKey, rows, cols, values, baseRow: half, baseCol: half };
}

export function computeIntrinsicValue(base: IntrinsicBase, a: IntrinsicAssumptions): IntrinsicResult {
  const shell: IntrinsicResult = {
    modelVersion: INTRINSIC_MODEL_VERSION,
    methodology: "MODERN_EXTENSION",
    status: "NOT_ESTABLISHED",
    reason: "disabled",
    method: a.method,
    value: null,
    low: null,
    high: null,
    assumptions: a,
    inputs: { baseRevenue: null, baseShares: null, normalizedEps: null },
    projection: [],
    terminalValuePerShare: null,
    presentValueOfTerminal: null,
    terminalShare: null,
    terminalHeavy: false,
    sensitivity: null,
  };
  if (!a.enabled) return { ...shell, status: "DISABLED", reason: "disabled" };
  const p = prepare(base, a);
  const inputs = { baseRevenue: p.baseRevenue, baseShares: p.baseShares, normalizedEps: p.normalizedEps };
  if (p.reason) return { ...shell, inputs, reason: p.reason };
  const out = core(p, a);
  if (out.value === null) return { ...shell, inputs, reason: out.reason, projection: out.projection };
  const sensitivity = sensitivityAnalysis(base, a);
  // Range: inner band (discount ±1pp × growth ±1 step) around the base case; only positive values count.
  const band: number[] = [];
  if (sensitivity) {
    for (let i = sensitivity.baseRow - 1; i <= sensitivity.baseRow + 1; i++)
      for (let j = sensitivity.baseCol - 1; j <= sensitivity.baseCol + 1; j++) {
        const v = sensitivity.values[i]?.[j];
        if (v !== null && v !== undefined && v > 0) band.push(v);
      }
  }
  const terminalShare = out.presentValueOfTerminal !== null ? out.presentValueOfTerminal / out.value : null;
  return {
    ...shell,
    status: "ESTABLISHED",
    reason: "computed",
    inputs,
    value: out.value,
    low: band.length ? Math.min(...band, out.value) : out.value,
    high: band.length ? Math.max(...band, out.value) : out.value,
    projection: out.projection,
    terminalValuePerShare: out.terminalValuePerShare,
    presentValueOfTerminal: out.presentValueOfTerminal,
    terminalShare,
    terminalHeavy: terminalShare !== null && terminalShare > 0.75,
    sensitivity,
  };
}
