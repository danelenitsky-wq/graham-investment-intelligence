/**
 * Dividend evidence for D4 (20-year record) and E4 (current dividend).
 * Pure functions; see registry entries AI-DIV-FY, AI-DIV-COVERAGE,
 * AI-DIST-FILTER and AI-CURRENT-DIV.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";
import type { DividendInput, GrahamInputs } from "./types";

/** A provider "dividend" of this share of the price or more is treated as a non-cash distribution. */
export const DISTRIBUTION_PRICE_SHARE = 0.25;
const CLOSE_LOOKBACK_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ExcludedDistribution {
  exDate: string;
  amount: number;
  close: number;
  shareOfPrice: number;
  reason: "DISTRIBUTION_EXCEEDS_PRICE_SHARE";
}

export interface DividendScreen {
  kept: DividendInput[];
  excluded: ExcludedDistribution[];
}

/** Close on the ex-date, or the nearest earlier close within a week. */
function closeOnOrBefore(sortedCloses: { date: string; close: number }[], date: string): number | null {
  let lo = 0;
  let hi = sortedCloses.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedCloses[mid].date <= date) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return null;
  const c = sortedCloses[idx];
  if ((Date.parse(date) - Date.parse(c.date)) / DAY_MS > CLOSE_LOOKBACK_DAYS) return null;
  // The ex-date close is already ex-dividend: compare with the previous close when the ex-date is a trading day.
  if (c.date === date && idx > 0) return sortedCloses[idx - 1].close;
  return c.close;
}

/** Remove provider "cash dividends" that are really share distributions (e.g. GOOGL 2014-04-02, $567.97). */
export function screenDistributions(dividends: DividendInput[], closes: { date: string; close: number }[] = []): DividendScreen {
  const sorted = [...closes].sort((a, b) => a.date.localeCompare(b.date));
  const kept: DividendInput[] = [];
  const excluded: ExcludedDistribution[] = [];
  for (const d of dividends) {
    if (!(d.amount > 0)) continue;
    const close = closeOnOrBefore(sorted, d.exDate);
    if (close !== null && close > 0 && d.amount / close >= DISTRIBUTION_PRICE_SHARE) {
      excluded.push({ exDate: d.exDate, amount: d.amount, close, shareOfPrice: d.amount / close, reason: "DISTRIBUTION_EXCEEDS_PRICE_SHARE" });
    } else kept.push(d);
  }
  return { kept, excluded };
}

/** Fiscal year (labelled by the calendar year in which it ends) that contains `date`. */
export function fiscalYearOfDate(date: string, fiscalYearEndMonth: number | null | undefined): number {
  const d = new Date(date + "T00:00:00Z");
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  const fyEnd = fiscalYearEndMonth && fiscalYearEndMonth >= 1 && fiscalYearEndMonth <= 12 ? fiscalYearEndMonth : 12;
  return m > fyEnd ? y + 1 : y;
}

/** Calendar bounds [start, end] of fiscal year `fy` (labelled by the year in which it ends). */
export function fiscalYearBounds(fy: number, fiscalYearEndMonth: number | null | undefined): { start: string; end: string } {
  const m = fiscalYearEndMonth && fiscalYearEndMonth >= 1 && fiscalYearEndMonth <= 12 ? fiscalYearEndMonth : 12;
  const end = new Date(Date.UTC(fy, m, 0)); // last day of month m in year fy
  const start = new Date(Date.UTC(m === 12 ? fy : fy - 1, m === 12 ? 0 : m, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Daily histories start/end on trading days: allow this gap at either edge of a fiscal year. */
const EDGE_TOLERANCE_DAYS = 7;

/** Fiscal years fully spanned by a daily history [first, last]. */
export function fullyCoveredFiscalYears(range: { first: string; last: string } | null | undefined, fiscalYearEndMonth: number | null | undefined): number[] {
  if (!range) return [];
  const out: number[] = [];
  const firstFy = fiscalYearOfDate(range.first, fiscalYearEndMonth);
  const lastFy = fiscalYearOfDate(range.last, fiscalYearEndMonth);
  for (let y = firstFy; y <= lastFy; y++) {
    const b = fiscalYearBounds(y, fiscalYearEndMonth);
    const startOk = (Date.parse(range.first) - Date.parse(b.start)) / DAY_MS <= EDGE_TOLERANCE_DAYS;
    const endOk = (Date.parse(b.end) - Date.parse(range.last)) / DAY_MS <= EDGE_TOLERANCE_DAYS;
    if (startOk && endOk) out.push(y);
  }
  return out;
}

export interface DividendEvidence {
  /** Fiscal years with a cash dividend. */
  paid: Set<number>;
  /** Fiscal years where the data proves whether a dividend was paid. */
  covered: Set<number>;
  screen: DividendScreen;
  /** Cash dividends per fiscal year from the provider (after screening). */
  perYear: Map<number, number>;
}

export function dividendEvidence(inputs: GrahamInputs, annual: AnnualFinancials[]): DividendEvidence {
  const screen = screenDistributions(inputs.dividends ?? [], inputs.closes);
  const paid = new Set<number>(inputs.dividendYears ?? []);
  const covered = new Set<number>(inputs.dividendCoverageYears ?? []);
  const perYear = new Map<number, number>();
  if (inputs.dividends) {
    for (const d of screen.kept) {
      const fy = fiscalYearOfDate(d.exDate, inputs.fiscalYearEndMonth);
      paid.add(fy);
      perYear.set(fy, (perYear.get(fy) ?? 0) + d.amount);
    }
    for (const y of fullyCoveredFiscalYears(inputs.priceHistoryRange, inputs.fiscalYearEndMonth)) covered.add(y);
  }
  for (const a of annual) {
    const dps = a.values.dividendsPerShare;
    const cash = a.values.dividendsPaid;
    if ((dps ?? 0) > 0 || Math.abs(cash ?? 0) > 0) {
      paid.add(a.fiscalYear);
      covered.add(a.fiscalYear);
    } else if (dps === 0 || cash === 0) {
      // An explicitly reported zero is evidence of no dividend; an absent tag is not.
      covered.add(a.fiscalYear);
    }
  }
  return { paid, covered, screen, perYear };
}

/** Kept dividends with an ex-date in the `days` before `asOf` (exclusive of later dates). */
export function dividendsInWindow(kept: DividendInput[], asOf: string, days = 365): DividendInput[] {
  const end = Date.parse(asOf);
  const start = end - days * DAY_MS;
  return kept.filter((d) => {
    const t = Date.parse(d.exDate);
    return t <= end && t > start;
  });
}
