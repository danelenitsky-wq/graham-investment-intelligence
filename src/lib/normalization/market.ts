/**
 * Market data normalization: provider-specific price rows → canonical daily
 * bars, with validation. Pure functions, no I/O.
 */

export interface NormalizedPriceBar {
  date: string; // YYYY-MM-DD, exchange session date
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjClose: number | null;
  volume: number | null;
  currency: string;
}

export interface NormalizedDividend {
  exDate: string;
  amount: number;
  currency: string;
}

export interface NormalizedSplit {
  exDate: string;
  ratio: number;
}

export interface BarRejection {
  date: string;
  reason: "NON_POSITIVE_CLOSE" | "OHLC_INCONSISTENT" | "INVALID_DATE" | "DUPLICATE_DATE" | "NEGATIVE_VOLUME";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts "2024-03-01" or "2024-03-01T00:00:00.000Z"; returns YYYY-MM-DD or null. */
export function toIsoDate(input: string): string | null {
  const s = input.slice(0, 10);
  if (!ISO_DATE.test(s)) return null;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isNaN(t) ? null : s;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Validate and de-duplicate bars. Bars failing sanity checks are rejected (and
 * reported) rather than silently "fixed": we never invent prices.
 */
export function validatePriceBars(bars: NormalizedPriceBar[]): {
  bars: NormalizedPriceBar[];
  rejected: BarRejection[];
} {
  const rejected: BarRejection[] = [];
  const seen = new Set<string>();
  const out: NormalizedPriceBar[] = [];
  for (const b of [...bars].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!toIsoDate(b.date)) {
      rejected.push({ date: String(b.date), reason: "INVALID_DATE" });
      continue;
    }
    if (seen.has(b.date)) {
      rejected.push({ date: b.date, reason: "DUPLICATE_DATE" });
      continue;
    }
    if (!(b.close > 0)) {
      rejected.push({ date: b.date, reason: "NON_POSITIVE_CLOSE" });
      continue;
    }
    if (b.volume !== null && b.volume < 0) {
      rejected.push({ date: b.date, reason: "NEGATIVE_VOLUME" });
      continue;
    }
    const { open, high, low, close } = b;
    if (high !== null && low !== null) {
      const eps = 1e-9;
      const inRange = (v: number | null) => v === null || (v >= low - eps && v <= high + eps);
      if (high < low || !inRange(open) || !inRange(close)) {
        rejected.push({ date: b.date, reason: "OHLC_INCONSISTENT" });
        continue;
      }
    }
    seen.add(b.date);
    out.push(b);
  }
  return { bars: out, rejected };
}

export function makeBar(input: {
  date: string;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close: unknown;
  adjClose?: unknown;
  volume?: unknown;
  currency: string;
}): NormalizedPriceBar | null {
  const date = toIsoDate(input.date);
  const close = finiteOrNull(input.close);
  if (!date || close === null) return null;
  return {
    date,
    open: finiteOrNull(input.open),
    high: finiteOrNull(input.high),
    low: finiteOrNull(input.low),
    close,
    adjClose: finiteOrNull(input.adjClose),
    volume: finiteOrNull(input.volume),
    currency: input.currency,
  };
}

/**
 * TASE quotes equities in agorot (ILA, 1/100 ILS). Normalize to ILS so that
 * prices are comparable with ILS-denominated financial statements.
 */
export function normalizeCurrencyUnit(price: number, currency: string): { price: number; currency: string } {
  if (currency === "ILA") return { price: price / 100, currency: "ILS" };
  if (currency === "GBX" || currency === "GBp") return { price: price / 100, currency: "GBP" };
  return { price, currency };
}

/**
 * Price series for charts and 1-year ranges: the split- and dividend-adjusted
 * close (Tiingo adjClose), so a split is not drawn as a crash (NVDA 10:1 in
 * 2024, GOOGL 20:1 in 2022). The latest adjusted close equals the latest
 * close, so today's price lines up with current per-share thresholds. A bar
 * without an adjusted value is kept (raw close) only when no split follows it.
 */
export function adjustedChartSeries(
  bars: { date: string; close: number; adjClose: number | null }[],
  splitDates: string[],
): { date: string; close: number }[] {
  const lastSplit = splitDates.length ? [...splitDates].sort().at(-1)! : null;
  return bars.flatMap((b) => {
    if (b.adjClose !== null && Number.isFinite(b.adjClose)) return [{ date: b.date, close: b.adjClose }];
    return lastSplit === null || b.date >= lastSplit ? [{ date: b.date, close: b.close }] : [];
  });
}
