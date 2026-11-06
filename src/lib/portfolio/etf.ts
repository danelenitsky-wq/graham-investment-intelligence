/**
 * ETF metrics (pure). Graham's company criteria (size, current ratio,
 * earnings record, P/E, P/B…) describe one operating business and are
 * NOT_APPLICABLE to a fund. What can be reported reliably from free stored
 * data instead:
 *
 * - trailing-12-month distribution yield (cash distributions with an ex-date
 *   in the last 365 days ÷ latest price; non-cash "distributions" removed by
 *   the same filter as the Graham engine),
 * - total return over 1 and 3 years from the provider's adjusted close
 *   (dividends and splits reinvested/adjusted; null without adjusted data),
 * - 52-week high / low and the distance from the high.
 *
 * Expense ratio, holdings and tracking error are not available from the free
 * sources and are not shown.
 */
import { screenDistributions } from "@/lib/graham/dividends";

export interface EtfBar {
  date: string;
  close: number;
  adjClose: number | null;
}

export interface EtfMetrics {
  distributionYieldTtm: number | null;
  distributionsTtm: number | null;
  distributionCountTtm: number;
  totalReturn1y: number | null;
  totalReturn3y: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** price / 52-week high − 1. */
  distanceFromHigh: number | null;
  /** Provider "dividends" removed as non-cash distributions. */
  excludedDistributions: number;
  asOf: string | null;
}

const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") - days * DAY).toISOString().slice(0, 10);

function onOrBefore(bars: EtfBar[], date: string, maxGapDays = 7): EtfBar | null {
  let best: EtfBar | null = null;
  for (const b of bars) {
    if (b.date <= date) best = b;
    else break;
  }
  if (!best) return null;
  return (Date.parse(date) - Date.parse(best.date)) / DAY <= maxGapDays ? best : null;
}

export function etfMetrics(input: { bars: EtfBar[]; dividends: { exDate: string; amount: number }[]; price: number | null; priceDate: string | null }): EtfMetrics {
  const bars = [...input.bars].sort((a, b) => a.date.localeCompare(b.date));
  const last = bars[bars.length - 1] ?? null;
  const asOf = input.priceDate ?? last?.date ?? null;
  const price = input.price ?? last?.close ?? null;
  if (!asOf) {
    return { distributionYieldTtm: null, distributionsTtm: null, distributionCountTtm: 0, totalReturn1y: null, totalReturn3y: null, yearHigh: null, yearLow: null, distanceFromHigh: null, excludedDistributions: 0, asOf: null };
  }
  const screen = screenDistributions(input.dividends, bars.map((b) => ({ date: b.date, close: b.close })));
  const since = shift(asOf, 365);
  const ttm = screen.kept.filter((d) => d.exDate > since && d.exDate <= asOf);
  const distributionsTtm = ttm.reduce((s, d) => s + d.amount, 0);
  // Only state a yield when a full year of daily history exists (otherwise "no distributions" is unproven).
  const historyCoversYear = bars.length > 0 && bars[0].date <= shift(asOf, 358);
  const yearBars = bars.filter((b) => b.date > since && b.date <= asOf);
  const yearHigh = historyCoversYear && yearBars.length ? Math.max(...yearBars.map((b) => b.close)) : null;
  const yearLow = historyCoversYear && yearBars.length ? Math.min(...yearBars.map((b) => b.close)) : null;
  const tr = (years: number) => {
    const end = onOrBefore(bars, asOf);
    const start = onOrBefore(bars, shift(asOf, Math.round(365.25 * years)));
    if (!end || !start || end.adjClose === null || start.adjClose === null || start.adjClose <= 0) return null;
    return end.adjClose / start.adjClose - 1;
  };
  return {
    distributionYieldTtm: historyCoversYear && price && price > 0 ? distributionsTtm / price : null,
    distributionsTtm: historyCoversYear ? distributionsTtm : null,
    distributionCountTtm: ttm.length,
    totalReturn1y: tr(1),
    totalReturn3y: tr(3),
    yearHigh,
    yearLow,
    distanceFromHigh: price && yearHigh ? price / yearHigh - 1 : null,
    excludedDistributions: screen.excluded.length,
    asOf,
  };
}
