/**
 * Cross-source verification (pure).
 *
 * Primary filings (SEC XBRL) are the source of record for financial
 * statements. When an independent provider is configured, material figures are
 * compared period by period and every disagreement beyond tolerance is flagged
 * as a CONFLICT. Nothing is averaged or silently replaced: the primary value is
 * kept and the conflict is surfaced so downstream analysis can refuse to run.
 */
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import { isTradingDay, localParts, previousTradingDay, sessionCloseTime, zonedTimeToUtc, type ExchangeCalendar } from "@/lib/market/calendar";

export type VerificationStatus = "VERIFIED" | "CONFLICT" | "SINGLE_SOURCE" | "UNVERIFIED";

export interface Tolerance {
  /** Relative tolerance (0.01 = 1%). */
  rel: number;
  /** Absolute tolerance in the metric's unit; differences below it always pass. */
  abs: number;
}

/** Figures that drive Graham's tests and valuation. */
export const MATERIAL_METRICS: Partial<Record<CanonicalConcept, Tolerance>> = {
  revenue: { rel: 0.01, abs: 1_000_000 },
  netIncome: { rel: 0.01, abs: 1_000_000 },
  epsDiluted: { rel: 0.02, abs: 0.015 },
  totalAssets: { rel: 0.01, abs: 1_000_000 },
  currentAssets: { rel: 0.015, abs: 1_000_000 },
  currentLiabilities: { rel: 0.015, abs: 1_000_000 },
  totalLiabilities: { rel: 0.015, abs: 1_000_000 },
  stockholdersEquity: { rel: 0.015, abs: 1_000_000 },
  operatingCashFlow: { rel: 0.015, abs: 1_000_000 },
};

/** Cash-flow outflows are reported positive by SEC tags and negative by most vendors. */
const SIGN_AGNOSTIC: ReadonlySet<CanonicalConcept> = new Set(["capitalExpenditures", "dividendsPaid"]);

export interface FigureComparison {
  status: "VERIFIED" | "CONFLICT";
  relDiff: number;
  absDiff: number;
}

export function compareFigures(primary: number, secondary: number, tol: Tolerance): FigureComparison {
  const absDiff = Math.abs(primary - secondary);
  const denom = Math.max(Math.abs(primary), Math.abs(secondary));
  const relDiff = denom === 0 ? 0 : absDiff / denom;
  const ok = absDiff <= tol.abs || relDiff <= tol.rel;
  return { status: ok ? "VERIFIED" : "CONFLICT", relDiff, absDiff };
}

export interface SourcedPeriod {
  periodEnd: string;
  fiscalYear: number;
  fiscalPeriod: string; // FY, Q1..Q4
  values: Partial<Record<CanonicalConcept, number>>;
  /** Reference to the original document (accession number, URL…). */
  reference?: string | null;
}

export interface MetricComparison {
  metric: CanonicalConcept;
  fiscalYear: number;
  fiscalPeriod: string;
  periodEnd: string;
  primaryValue: number;
  secondaryValue: number | null;
  primaryReference: string | null;
  secondaryReference: string | null;
  relDiff: number | null;
  status: VerificationStatus;
  /** True when the secondary value matched only after split-adjusting it. */
  splitAdjusted?: boolean;
  tolerance: Tolerance;
}

const DAY = 86_400_000;

/**
 * Compare material metrics of primary vs secondary periods. Periods are matched
 * on fiscal period label and a period end within `maxEndSkewDays` (vendors
 * sometimes report the calendar month end instead of the 52/53-week date).
 */
export function verifyPeriods(
  primary: SourcedPeriod[],
  secondary: SourcedPeriod[],
  options: {
    maxEndSkewDays?: number;
    metrics?: Partial<Record<CanonicalConcept, Tolerance>>;
    /** Cumulative split factor after a date (for per-share comparisons). */
    splitFactorAfter?: (isoDate: string) => number;
  } = {},
): MetricComparison[] {
  const skew = (options.maxEndSkewDays ?? 10) * DAY;
  const metrics = options.metrics ?? MATERIAL_METRICS;
  const out: MetricComparison[] = [];
  for (const p of primary) {
    const match = secondary.find(
      (s) => s.fiscalPeriod === p.fiscalPeriod && Math.abs(Date.parse(s.periodEnd) - Date.parse(p.periodEnd)) <= skew,
    );
    for (const [metric, tol] of Object.entries(metrics) as [CanonicalConcept, Tolerance][]) {
      const pv = p.values[metric];
      if (pv === undefined) continue;
      const base = {
        metric,
        fiscalYear: p.fiscalYear,
        fiscalPeriod: p.fiscalPeriod,
        periodEnd: p.periodEnd,
        primaryValue: pv,
        primaryReference: p.reference ?? null,
        secondaryReference: match?.reference ?? null,
        tolerance: tol,
      };
      const sv = match?.values[metric];
      if (sv === undefined) {
        out.push({ ...base, secondaryValue: null, relDiff: null, status: "SINGLE_SOURCE" });
        continue;
      }
      const a = SIGN_AGNOSTIC.has(metric) ? Math.abs(pv) : pv;
      const b = SIGN_AGNOSTIC.has(metric) ? Math.abs(sv) : sv;
      let cmp = compareFigures(a, b, tol);
      let splitAdjusted = false;
      // SEC per-share values are split-adjusted by our normalizer; vendors may report them as originally filed.
      if (cmp.status === "CONFLICT" && metric === "epsDiluted" && options.splitFactorAfter) {
        const factor = options.splitFactorAfter(p.periodEnd);
        if (factor !== 1) {
          const adj = compareFigures(a, b / factor, tol);
          if (adj.status === "VERIFIED") {
            cmp = adj;
            splitAdjusted = true;
          }
        }
      }
      out.push({ ...base, secondaryValue: sv, relDiff: cmp.relDiff, status: cmp.status, splitAdjusted });
    }
  }
  return out;
}

/** Roll-up of a set of comparisons (worst status wins). */
export function summarizeVerification(comparisons: { status: VerificationStatus }[]): VerificationStatus {
  if (comparisons.length === 0) return "UNVERIFIED";
  if (comparisons.some((c) => c.status === "CONFLICT")) return "CONFLICT";
  if (comparisons.some((c) => c.status === "VERIFIED")) return "VERIFIED";
  return "SINGLE_SOURCE";
}

// ─────────────────────────────── Quotes ───────────────────────────────

export interface QuotePoint {
  provider: string;
  price: number;
  sourceTimestamp: string;
  previousClose?: number | null;
  /**
   * Official session closes this quote vouches for, keyed by exchange-local
   * trading date. An end-of-day quote vouches for its own close; an intraday
   * quote for its previous close. Lets a delayed intraday quote be checked
   * against an end-of-day close from another provider without a false conflict.
   */
  closes?: { date: string; value: number }[];
}

export interface QuoteVerification {
  status: VerificationStatus;
  comparedField: "price" | "previousClose" | `close:${string}` | null;
  primary: number | null;
  secondary: number | null;
  relDiff: number | null;
  secondaryProvider: string | null;
  note: "TIMESTAMPS_TOO_FAR_APART" | "NO_SECONDARY" | null;
}

/**
 * Compare a quote with an independent provider. Prices are only compared when
 * both were observed within `maxSkewSeconds`; otherwise previous closes are
 * compared (they are fixed numbers and should agree exactly up to rounding).
 */
export function verifyQuote(
  primary: QuotePoint,
  secondary: QuotePoint | null,
  options: { relTolerance?: number; maxSkewSeconds?: number } = {},
): QuoteVerification {
  const tol = options.relTolerance ?? 0.005;
  if (!secondary) return { status: "SINGLE_SOURCE", comparedField: null, primary: primary.price, secondary: null, relDiff: null, secondaryProvider: null, note: "NO_SECONDARY" };
  const skew = Math.abs(Date.parse(primary.sourceTimestamp) - Date.parse(secondary.sourceTimestamp)) / 1000;
  if (skew <= (options.maxSkewSeconds ?? 900)) {
    const c = compareFigures(primary.price, secondary.price, { rel: tol, abs: 0.01 });
    return { status: c.status, comparedField: "price", primary: primary.price, secondary: secondary.price, relDiff: c.relDiff, secondaryProvider: secondary.provider, note: null };
  }
  if (primary.closes && secondary.closes) {
    // Most recent trading date both providers vouch for.
    const other = new Map(secondary.closes.map((c) => [c.date, c.value]));
    const common = primary.closes.filter((c) => other.has(c.date)).sort((x, y) => y.date.localeCompare(x.date))[0];
    if (common) {
      const sv = other.get(common.date)!;
      const c = compareFigures(common.value, sv, { rel: tol, abs: 0.01 });
      return { status: c.status, comparedField: `close:${common.date}`, primary: common.value, secondary: sv, relDiff: c.relDiff, secondaryProvider: secondary.provider, note: null };
    }
    return { status: "SINGLE_SOURCE", comparedField: null, primary: primary.price, secondary: secondary.price, relDiff: null, secondaryProvider: secondary.provider, note: "TIMESTAMPS_TOO_FAR_APART" };
  }
  if (primary.previousClose != null && secondary.previousClose != null) {
    const c = compareFigures(primary.previousClose, secondary.previousClose, { rel: tol, abs: 0.01 });
    return { status: c.status, comparedField: "previousClose", primary: primary.previousClose, secondary: secondary.previousClose, relDiff: c.relDiff, secondaryProvider: secondary.provider, note: null };
  }
  return { status: "SINGLE_SOURCE", comparedField: null, primary: primary.price, secondary: secondary.price, relDiff: null, secondaryProvider: secondary.provider, note: "TIMESTAMPS_TOO_FAR_APART" };
}

/**
 * Official closes a quote vouches for (see QuotePoint.closes). An end-of-day
 * quote, or an intraday quote stamped at/after the session close, vouches for
 * that day's close; its previous close belongs to the previous trading day.
 */
export function quoteCloses(
  quote: { price: number; previousClose: number | null; sourceTimestamp: string; feed: string },
  cal: ExchangeCalendar,
  closeToleranceMinutes = 1,
): { date: string; value: number }[] {
  const ts = new Date(quote.sourceTimestamp);
  if (!Number.isFinite(ts.getTime())) return [];
  const date = localParts(ts, cal.timezone).date;
  if (!isTradingDay(cal, date)) return [];
  const out: { date: string; value: number }[] = [];
  const close = zonedTimeToUtc(date, sessionCloseTime(cal, date), cal.timezone).getTime();
  if (quote.feed === "EOD" || ts.getTime() >= close - closeToleranceMinutes * 60_000) out.push({ date, value: quote.price });
  if (quote.previousClose != null) out.push({ date: previousTradingDay(cal, date), value: quote.previousClose });
  return out;
}

export interface DividendYearCheck {
  fiscalYear: number;
  secValue: number;
  providerSum: number;
  /** Ex-dates of the provider dividends that make up providerSum. */
  exDates: string[];
  status: "VERIFIED" | "SINGLE_SOURCE";
}

const shiftDays = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Cross-check per-payment dividends (e.g. Tiingo divCash) against the SEC
 * "dividends declared per share" of each fiscal year. Declaration and ex-dates
 * can fall in different fiscal years, so the fiscal-year window and the same
 * window shifted by ~one quarter are both tried. Agreement upgrades the year to
 * VERIFIED; disagreement only leaves it SINGLE_SOURCE (timing differences are
 * not proof of a wrong value), and never alters the stored amounts.
 */
export function verifyDividendYears(
  dividends: { exDate: string; amount: number }[],
  secYears: { fiscalYear: number; periodStart: string | null; periodEnd: string; value: number }[],
  /** Brings a payment to the share basis of the SEC figure (split adjustment). */
  toSecBasis: (exDate: string, amount: number, periodEnd: string) => number = (_d, a) => a,
  tol: Tolerance = { rel: 0.02, abs: 0.005 },
): DividendYearCheck[] {
  const out: DividendYearCheck[] = [];
  for (const y of secYears) {
    if (!(y.value > 0)) continue;
    const start = y.periodStart ?? shiftDays(y.periodEnd, -364);
    let best: DividendYearCheck | null = null;
    for (const shift of [0, 60]) {
      const from = shiftDays(start, shift);
      const to = shiftDays(y.periodEnd, shift);
      const inWindow = dividends.filter((d) => d.exDate >= from && d.exDate <= to);
      const sum = inWindow.reduce((s, d) => s + toSecBasis(d.exDate, d.amount, y.periodEnd), 0);
      const c = compareFigures(y.value, sum, tol);
      const check: DividendYearCheck = {
        fiscalYear: y.fiscalYear,
        secValue: y.value,
        providerSum: Math.round(sum * 1e6) / 1e6,
        exDates: inWindow.map((d) => d.exDate),
        status: inWindow.length > 0 && c.status === "VERIFIED" ? "VERIFIED" : "SINGLE_SOURCE",
      };
      if (!best || check.status === "VERIFIED") best = check;
      if (check.status === "VERIFIED") break;
    }
    if (best) out.push(best);
  }
  return out;
}
