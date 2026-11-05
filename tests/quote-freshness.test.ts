import { describe, expect, it } from "vitest";
import { TASE_CALENDAR, US_EQUITY_CALENDAR, sessionInfo } from "@/lib/market/calendar";
import { classifyQuote, decideQuoteFetch, isUsableQuoteStatus, type QuoteObservation } from "@/lib/freshness/quote";

const OPEN_NOW = new Date("2026-11-04T15:00:00Z"); // Wed 10:00 ET
const AFTER_CLOSE = new Date("2026-11-04T22:00:00Z"); // Wed 17:00 ET
const SATURDAY = new Date("2026-11-07T15:00:00Z");
const THANKSGIVING = new Date("2026-11-26T16:00:00Z");
const session = (now: Date) => sessionInfo(US_EQUITY_CALENDAR, now);

function q(sourceTimestamp: string, feed: QuoteObservation["feed"] = "REALTIME", retrievedAt = sourceTimestamp): QuoteObservation {
  return { price: 100, sourceTimestamp, retrievedAt, feed, delayMinutes: null };
}
const classify = (quote: QuoteObservation | null, now: Date, lastFetchFailed = false) =>
  classifyQuote({ quote, session: session(now), now, lastFetchFailed });

describe("quote status — market open", () => {
  it("FRESH only for a provider-confirmed real-time feed with a fresh timestamp", () => {
    expect(classify(q("2026-11-04T14:59:30Z"), OPEN_NOW).status).toBe("FRESH");
  });

  it("never FRESH when the feed is not confirmed real-time, however fresh", () => {
    for (const feed of ["UNKNOWN", "DELAYED"] as const) {
      const c = classify(q("2026-11-04T14:59:59Z", feed), OPEN_NOW);
      expect(c.status).toBe("DELAYED");
      expect(c.status).not.toBe("FRESH");
    }
  });

  it("DELAYED when a real-time quote is older than 2 minutes but within the delay window", () => {
    const c = classify(q("2026-11-04T14:50:00Z"), OPEN_NOW);
    expect(c.status).toBe("DELAYED");
    expect(c.reasons).toContain("OLDER_THAN_DELAY");
  });

  it("STALE when older than the delay window during the session", () => {
    expect(classify(q("2026-11-04T14:31:00Z"), OPEN_NOW).status).toBe("STALE");
  });

  it("shows yesterday's close as LAST_CLOSE right after the open, STALE later", () => {
    const prevClose = "2026-11-03T21:00:00Z";
    expect(classify(q(prevClose), new Date("2026-11-04T14:35:00Z")).status).toBe("LAST_CLOSE");
    expect(classify(q(prevClose), OPEN_NOW).status).toBe("STALE");
  });

  it("an end-of-day feed during the session shows the previous close as LAST_CLOSE", () => {
    expect(classify(q("2026-11-03T21:00:00Z", "EOD"), OPEN_NOW).status).toBe("LAST_CLOSE");
    expect(classify(q("2026-11-02T21:00:00Z", "EOD"), OPEN_NOW).status).toBe("STALE");
  });
});

describe("quote status — market closures", () => {
  it("LAST_CLOSE after the close for a quote stamped at the close", () => {
    expect(classify(q("2026-11-04T21:00:00Z"), AFTER_CLOSE).status).toBe("LAST_CLOSE");
    // A real-time feed is not "Live" once the market is closed.
    expect(classify(q("2026-11-04T20:59:58Z"), AFTER_CLOSE).status).toBe("LAST_CLOSE");
  });

  it("a mid-session quote is STALE after the close", () => {
    expect(classify(q("2026-11-04T17:00:00Z"), AFTER_CLOSE).status).toBe("STALE");
  });

  it("weekend: Friday's close is LAST_CLOSE, Thursday's is STALE", () => {
    expect(classify(q("2026-11-06T21:00:00Z"), SATURDAY).status).toBe("LAST_CLOSE");
    expect(classify(q("2026-11-05T21:00:00Z"), SATURDAY).status).toBe("STALE");
  });

  it("holiday: the day before is the last close", () => {
    expect(classify(q("2026-11-25T21:00:00Z"), THANKSGIVING).status).toBe("LAST_CLOSE");
  });

  it("early-close day: the 13:00 ET quote is the close", () => {
    expect(classify(q("2026-11-27T18:00:00Z"), new Date("2026-11-27T20:00:00Z")).status).toBe("LAST_CLOSE");
  });

  it("unknown calendars (TASE) are never LIVE or LAST_CLOSE", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    const s = sessionInfo(TASE_CALENDAR, now);
    expect(classifyQuote({ quote: q("2026-11-04T09:59:50Z"), session: s, now, lastFetchFailed: false }).status).toBe("DELAYED");
    expect(classifyQuote({ quote: q("2026-11-03T15:00:00Z"), session: s, now, lastFetchFailed: false }).status).toBe("STALE");
  });
});

describe("quote status — failures and edge cases", () => {
  it("UNAVAILABLE without any quote", () => {
    expect(classify(null, OPEN_NOW).status).toBe("UNAVAILABLE");
  });

  it("CACHED when the provider failed but the last verified value is recent", () => {
    const c = classify(q("2026-11-04T14:58:00Z", "REALTIME", "2026-11-04T14:58:01Z"), OPEN_NOW, true);
    expect(c.status).toBe("CACHED");
    expect(c.baseStatus).toBe("FRESH");
    expect(c.reasons).toContain("PROVIDER_FAILED_USING_CACHE");
  });

  it("STALE when the provider keeps failing and the cache is too old", () => {
    const c = classify(q("2026-11-04T14:50:00Z", "REALTIME", "2026-11-04T14:30:00Z"), OPEN_NOW, true);
    expect(c.status).toBe("STALE");
    expect(c.reasons).toContain("CACHE_TOO_OLD");
  });

  it("a cached last close stays CACHED (not stale) while the market is closed", () => {
    expect(classify(q("2026-11-06T21:00:00Z", "REALTIME", "2026-11-06T21:05:00Z"), SATURDAY, true).status).toBe("CACHED");
  });

  it("rejects timestamps in the future", () => {
    expect(classify(q("2026-11-04T16:00:00Z"), OPEN_NOW).status).toBe("STALE");
  });

  it("only usable statuses feed analysis", () => {
    expect(["FRESH", "DELAYED", "LAST_CLOSE", "CACHED"].every((s) => isUsableQuoteStatus(s as never))).toBe(true);
    expect(isUsableQuoteStatus("STALE")).toBe(false);
    expect(isUsableQuoteStatus("UNAVAILABLE")).toBe(false);
  });
});

describe("quote cache invalidation", () => {
  const openSession = session(OPEN_NOW);
  const cachedOpen = { retrievedAt: "2026-11-04T14:59:30Z", sessionState: "OPEN" as const, sessionDate: "2026-11-04" };
  const decide = (over: Partial<Parameters<typeof decideQuoteFetch>[0]>) =>
    decideQuoteFetch({ cached: cachedOpen, lastAttempt: null, session: openSession, now: OPEN_NOW, force: false, hasProvider: true, ...over });

  it("serves a fresh cache without a provider request", () => {
    expect(decide({})).toEqual({ fetch: false, reason: "CACHE_FRESH" });
  });

  it("expires after the open-market TTL so a 60 s poll always refetches", () => {
    expect(decide({ now: new Date("2026-11-04T15:00:25Z") })).toEqual({ fetch: true, reason: "TTL_EXPIRED" });
  });

  it("Refresh Now always makes a new request (except within the 2 s spam guard)", () => {
    expect(decide({ force: true })).toEqual({ fetch: true, reason: "FORCED" });
    expect(decide({ force: true, lastAttempt: { at: "2026-11-04T14:59:59Z", failed: false } })).toEqual({ fetch: false, reason: "FORCE_THROTTLED" });
  });

  it("invalidates across a session boundary (open → closed, new trading day)", () => {
    const closed = session(AFTER_CLOSE);
    expect(decide({ session: closed, now: AFTER_CLOSE })).toEqual({ fetch: true, reason: "SESSION_CHANGED" });
    const nextDay = session(new Date("2026-11-05T15:00:00Z"));
    expect(decide({ session: nextDay, now: new Date("2026-11-05T15:00:00Z") })).toEqual({ fetch: true, reason: "SESSION_CHANGED" });
  });

  it("uses a long TTL while closed", () => {
    const closed = session(SATURDAY);
    const cached = { retrievedAt: "2026-11-07T14:50:00Z", sessionState: "CLOSED" as const, sessionDate: "2026-11-07" };
    expect(decide({ cached, session: closed, now: SATURDAY })).toEqual({ fetch: false, reason: "CACHE_FRESH" });
    expect(decide({ cached, session: closed, now: new Date("2026-11-07T15:30:00Z") })).toEqual({ fetch: true, reason: "TTL_EXPIRED" });
  });

  it("backs off after a failed request instead of hammering the provider", () => {
    expect(decide({ cached: null, lastAttempt: { at: "2026-11-04T14:59:50Z", failed: true } })).toEqual({ fetch: false, reason: "FAILURE_BACKOFF" });
    expect(decide({ cached: null, lastAttempt: { at: "2026-11-04T14:59:00Z", failed: true } })).toEqual({ fetch: true, reason: "NO_CACHE" });
  });

  it("never fetches without a configured provider", () => {
    expect(decide({ hasProvider: false, force: true })).toEqual({ fetch: false, reason: "NO_PROVIDER" });
  });
});
