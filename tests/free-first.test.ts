/**
 * Free-first provider migration: new adapters (Finnhub, Twelve Data), local
 * rate budgets, close-date cross-checks, CONFLICTED and statements statuses,
 * and dividend verification against SEC. Payloads are synthetic.
 */
import { describe, expect, it } from "vitest";
import { US_EQUITY_CALENDAR, sessionInfo } from "@/lib/market/calendar";
import { classifyQuote, isUsableQuoteStatus } from "@/lib/freshness/quote";
import { fundamentalsStatus, metricStatus } from "@/lib/freshness/status";
import { finnhubQuoteSchema, parseFinnhubQuote } from "@/lib/providers/finnhub/parse";
import { parseTwelveDataQuote, twelveDataError, twelveDataQuoteSchema } from "@/lib/providers/twelve-data/parse";
import { RateLimiter } from "@/lib/providers/rate-limit";
import { quoteCloses, verifyDividendYears, verifyQuote } from "@/lib/verification";

describe("Finnhub /quote parser", () => {
  it("maps fields and never claims real-time", () => {
    const q = parseFinnhubQuote("msft", finnhubQuoteSchema.parse({ c: 510.2, d: 2.2, dp: 0.433, h: 512, l: 505, o: 506, pc: 508, t: 1793895600 }))!;
    expect(q).toMatchObject({ symbol: "MSFT", price: 510.2, previousClose: 508, changePercent: 0.00433, feed: "UNKNOWN", feedNote: "FINNHUB_FREE" });
    expect(q.sourceTimestamp).toBe(new Date(1793895600 * 1000).toISOString());
  });
  it("treats the all-zero answer for unknown symbols as not found", () => {
    expect(parseFinnhubQuote("ZZZZ", finnhubQuoteSchema.parse({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }))).toBeNull();
  });
});

describe("Twelve Data /quote parser", () => {
  const body = {
    symbol: "NVDA",
    exchange: "NASDAQ",
    currency: "USD",
    datetime: "2026-11-04",
    timestamp: 1793851200,
    last_quote_at: 1793895600,
    open: "190.1",
    high: "193.5",
    low: "189.0",
    close: "192.25",
    volume: "150000000",
    previous_close: "190.00",
    change: "2.25",
    percent_change: "1.18421",
    is_market_open: true,
    fifty_two_week: { low: "86.62", high: "212.19" },
  };
  it("parses string numbers, 52-week range and the last-quote time", () => {
    const q = parseTwelveDataQuote("NVDA", twelveDataQuoteSchema.parse(body))!;
    expect(q).toMatchObject({ price: 192.25, previousClose: 190, yearLow: 86.62, yearHigh: 212.19, feed: "UNKNOWN", exchange: "NASDAQ" });
    expect(q.changePercent).toBeCloseTo(0.0118421, 6);
    expect(q.sourceTimestamp).toBe(new Date(1793895600 * 1000).toISOString());
  });
  it("recognises the HTTP-200 error envelope", () => {
    const r = twelveDataQuoteSchema.parse({ code: 429, message: "You have run out of API credits", status: "error" });
    expect(twelveDataError(r)).toEqual({ code: 429, message: "You have run out of API credits" });
    expect(parseTwelveDataQuote("NVDA", r)).toBeNull();
  });
});

describe("local rate budget", () => {
  it("refuses requests beyond the per-minute and per-day budget without recording them", () => {
    const rl = new RateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 7; i++) expect(rl.take("twelve-data", { perMinute: 7, perDay: 780 }, t0 + i)).toBeNull();
    const wait = rl.take("twelve-data", { perMinute: 7 }, t0 + 10);
    expect(wait).toBeGreaterThan(59_000);
    expect(rl.used("twelve-data", 60_000, t0 + 10)).toBe(7);
    expect(rl.take("twelve-data", { perMinute: 7 }, t0 + 61_000)).toBeNull();
  });
  it("keeps providers separate", () => {
    const rl = new RateLimiter();
    expect(rl.take("a", { perSecond: 1 }, 0)).toBeNull();
    expect(rl.take("a", { perSecond: 1 }, 1)).not.toBeNull();
    expect(rl.take("b", { perSecond: 1 }, 1)).toBeNull();
  });
});

describe("cross-check by trading date", () => {
  // Wed 2026-11-04 11:00 ET intraday quote; Tiingo's latest official close is Tue 2026-11-03.
  const intraday = { price: 510.2, previousClose: 508, sourceTimestamp: "2026-11-04T16:00:00Z", feed: "UNKNOWN" };
  const eod = { price: 508.01, previousClose: 505, sourceTimestamp: "2026-11-03T21:00:00Z", feed: "EOD" };

  it("an intraday quote vouches for the previous session's close; an EOD quote for its own", () => {
    expect(quoteCloses(intraday, US_EQUITY_CALENDAR)).toEqual([{ date: "2026-11-03", value: 508 }]);
    expect(quoteCloses(eod, US_EQUITY_CALENDAR)).toEqual([
      { date: "2026-11-03", value: 508.01 },
      { date: "2026-11-02", value: 505 },
    ]);
  });

  it("compares a delayed intraday quote with yesterday's official close, not with a different day", () => {
    const v = verifyQuote(
      { provider: "finnhub", ...intraday, closes: quoteCloses(intraday, US_EQUITY_CALENDAR) },
      { provider: "tiingo", ...eod, closes: quoteCloses(eod, US_EQUITY_CALENDAR) },
    );
    expect(v).toMatchObject({ status: "VERIFIED", comparedField: "close:2026-11-03" });
    // The old rule compared previousClose 508 with Tiingo's previousClose 505 (two different days) → false conflict.
    expect(verifyQuote({ provider: "finnhub", ...intraday }, { provider: "tiingo", ...eod }).status).toBe("CONFLICT");
  });

  it("flags a real disagreement on the same trading date", () => {
    const bad = { ...intraday, previousClose: 520 };
    expect(
      verifyQuote({ provider: "finnhub", ...bad, closes: quoteCloses(bad, US_EQUITY_CALENDAR) }, { provider: "tiingo", ...eod, closes: quoteCloses(eod, US_EQUITY_CALENDAR) }).status,
    ).toBe("CONFLICT");
  });
});

describe("CONFLICTED status", () => {
  const now = new Date("2026-11-04T15:00:00Z");
  const quote = { price: 100, sourceTimestamp: "2026-11-04T14:59:30Z", retrievedAt: "2026-11-04T14:59:31Z", feed: "REALTIME" as const };
  it("outranks time-based statuses and is not usable for analysis", () => {
    const c = classifyQuote({ quote, session: sessionInfo(US_EQUITY_CALENDAR, now), now, lastFetchFailed: false, conflicted: true });
    expect(c).toMatchObject({ status: "CONFLICTED", baseStatus: "FRESH" });
    expect(c.reasons).toContain("CROSS_CHECK_CONFLICT");
    expect(isUsableQuoteStatus("CONFLICTED")).toBe(false);
  });
  it("a missing quote stays UNAVAILABLE", () => {
    expect(classifyQuote({ quote: null, session: sessionInfo(US_EQUITY_CALENDAR, now), now, lastFetchFailed: false, conflicted: true }).status).toBe("UNAVAILABLE");
  });
});

describe("statements status — by reporting period, not retrieval time", () => {
  const f = (level: "FRESH" | "AGING" | "STALE" | "MISSING") => ({ level, asOf: "2026-06-30", ageDays: 128, isDevFixture: false });
  it("maps every case to the shared vocabulary", () => {
    expect(fundamentalsStatus({ freshness: f("MISSING"), newerFiling: false, lastRefreshFailed: false, conflicted: false }).status).toBe("UNAVAILABLE");
    expect(fundamentalsStatus({ freshness: f("FRESH"), newerFiling: false, lastRefreshFailed: false, conflicted: true }).status).toBe("CONFLICTED");
    expect(fundamentalsStatus({ freshness: f("FRESH"), newerFiling: true, lastRefreshFailed: false, conflicted: false })).toEqual({ status: "STALE", reasons: ["NEWER_FILING_NOT_LOADED"] });
    expect(fundamentalsStatus({ freshness: f("STALE"), newerFiling: false, lastRefreshFailed: false, conflicted: false }).status).toBe("STALE");
    expect(fundamentalsStatus({ freshness: f("FRESH"), newerFiling: false, lastRefreshFailed: true, conflicted: false }).status).toBe("CACHED");
    expect(fundamentalsStatus({ freshness: f("AGING"), newerFiling: false, lastRefreshFailed: false, conflicted: false }).status).toBe("DELAYED");
    expect(fundamentalsStatus({ freshness: f("FRESH"), newerFiling: false, lastRefreshFailed: false, conflicted: false }).status).toBe("FRESH");
  });
  it("a figure's own conflict wins over its dataset status", () => {
    expect(metricStatus("FRESH", "CONFLICT")).toBe("CONFLICTED");
    expect(metricStatus("CACHED", "VERIFIED")).toBe("CACHED");
  });
});

describe("dividends vs SEC dividends declared per share", () => {
  const msftLike = [
    { exDate: "2024-08-15", amount: 0.75 },
    { exDate: "2024-11-21", amount: 0.83 },
    { exDate: "2025-02-20", amount: 0.83 },
    { exDate: "2025-05-15", amount: 0.83 },
    { exDate: "2025-08-21", amount: 0.83 },
  ];
  it("verifies a fiscal year whose payments add up (trying a one-quarter shift for declaration timing)", () => {
    // FY Jul 2024–Jun 2025 declared 0.83×4 = 3.32; ex-dates fall Aug 2024–May 2025 (0.75+0.83×3 = 3.24) or shifted window (0.83×4 = 3.32).
    const r = verifyDividendYears(msftLike, [{ fiscalYear: 2025, periodStart: "2024-07-01", periodEnd: "2025-06-30", value: 3.32 }]);
    expect(r[0]).toMatchObject({ fiscalYear: 2025, status: "VERIFIED", providerSum: 3.32 });
  });
  it("leaves a mismatch SINGLE_SOURCE (timing is not proof of a wrong value)", () => {
    const r = verifyDividendYears(msftLike, [{ fiscalYear: 2025, periodStart: "2024-07-01", periodEnd: "2025-06-30", value: 4.0 }]);
    expect(r[0].status).toBe("SINGLE_SOURCE");
  });
  it("applies the split basis supplied by the caller", () => {
    const pre = [{ exDate: "2024-03-05", amount: 0.04 }, { exDate: "2024-06-11", amount: 0.01 }];
    // A 10-for-1 split on 2024-06-10: the March payment is 0.004 on today's basis.
    const r = verifyDividendYears(pre, [{ fiscalYear: 2025, periodStart: "2024-01-29", periodEnd: "2025-01-26", value: 0.014 }], (d, a) => (d < "2024-06-10" ? a / 10 : a));
    expect(r[0].status).toBe("VERIFIED");
  });
});
