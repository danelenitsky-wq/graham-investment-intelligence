/**
 * In-process request budget per provider (pure, no I/O).
 *
 * Free plans have hard limits (Finnhub 60/min, Twelve Data 8/min and 800/day,
 * Tiingo 50/hour and 1,000/day, SEC ≤ 10/s). Requests that would exceed the
 * configured budget are refused locally with RATE_LIMITED before anything is
 * sent, so the app never burns a quota or triggers a provider ban. The budget
 * is per server process; it is a safety net, not an exact mirror of the
 * provider's own counter.
 */
export interface RateBudget {
  perSecond?: number;
  perMinute?: number;
  perHour?: number;
  perDay?: number;
}

const WINDOWS: [keyof RateBudget, number][] = [
  ["perSecond", 1_000],
  ["perMinute", 60_000],
  ["perHour", 3_600_000],
  ["perDay", 86_400_000],
];

export class RateLimiter {
  private readonly log = new Map<string, number[]>();

  /** Records a request and returns null, or returns the ms to wait when the budget is spent (nothing recorded). */
  take(key: string, budget: RateBudget, now = Date.now()): number | null {
    const longest = Math.max(...WINDOWS.filter(([k]) => budget[k] !== undefined).map(([, ms]) => ms), 0);
    const times = (this.log.get(key) ?? []).filter((t) => now - t < longest);
    for (const [k, ms] of WINDOWS) {
      const limit = budget[k];
      if (limit === undefined) continue;
      const inWindow = times.filter((t) => now - t < ms);
      if (inWindow.length >= limit) {
        this.log.set(key, times);
        return inWindow[0] + ms - now;
      }
    }
    times.push(now);
    this.log.set(key, times);
    return null;
  }

  /** Requests counted in the last `ms` milliseconds. */
  used(key: string, ms: number, now = Date.now()): number {
    return (this.log.get(key) ?? []).filter((t) => now - t < ms).length;
  }

  reset() {
    this.log.clear();
  }
}

export const rateLimiter = new RateLimiter();

/** Documented free-plan limits, slightly under the provider's own numbers. */
export const FREE_PLAN_BUDGETS: Record<string, RateBudget> = {
  finnhub: { perSecond: 25, perMinute: 55 },
  "twelve-data": { perMinute: 7, perDay: 780 },
  tiingo: { perHour: 48, perDay: 950 },
  fmp: { perDay: 240 },
  "sec-edgar": { perSecond: 8 },
  // Bank of Israel publishes one rate a day; a few requests an hour is plenty and polite.
  boi: { perMinute: 10, perDay: 200 },
  // TASE Data Hub: documented 10 requests per 2 seconds for every product.
  "tase-datahub": { perSecond: 4 },
};
