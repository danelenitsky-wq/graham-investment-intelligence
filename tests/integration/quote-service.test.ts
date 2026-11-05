/**
 * Quote service against a real PostgreSQL with scripted (fake) providers.
 * Proves: page open fetches, the cache is honoured, Refresh Now makes a new
 * provider request, fallback on failure, last verified value preserved on
 * outage, and cross-provider conflicts are recorded. Values are synthetic.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { US_EQUITY_CALENDAR, sessionInfo } from "@/lib/market/calendar";
import { ProviderError, type NormalizedQuote, type QuoteProvider, type ProviderDescriptor } from "@/lib/providers/types";

type Script = { price: number; fail?: boolean };
const calls: Record<string, number> = { "fake-primary": 0, "fake-secondary": 0 };
const scripts: Record<string, Script> = { "fake-primary": { price: 100 }, "fake-secondary": { price: 100 } };

function descriptor(key: string): ProviderDescriptor {
  return { key, name: key, capabilities: ["QUOTES"], markets: ["US"], baseUrl: `https://${key}.test`, requiredEnv: [], isDevFixture: false };
}

/** A timestamp the classifier accepts for the current real session (now when open, the last close when closed). */
function sessionTimestamp() {
  const s = sessionInfo(US_EQUITY_CALENDAR, new Date());
  return s.state === "OPEN" ? new Date().toISOString() : s.lastSessionClose!;
}

function fake(key: string): QuoteProvider {
  return {
    descriptor: descriptor(key),
    feed: () => "REALTIME",
    supportsAutoRefresh: () => true,
    async getQuote() {
      calls[key]++;
      const sc = scripts[key];
      if (sc.fail) throw new ProviderError(key, "HTTP_ERROR", "HTTP 503", 503, `https://${key}.test/quote`);
      const quote: NormalizedQuote = {
        symbol: "ZZTEST",
        price: sc.price,
        previousClose: 99,
        change: sc.price - 99,
        changePercent: sc.price / 99 - 1,
        open: null,
        dayHigh: null,
        dayLow: null,
        volume: 1000,
        marketCap: 5e9,
        yearHigh: 120,
        yearLow: 80,
        currency: "USD",
        exchange: "NASDAQ",
        sourceTimestamp: sessionTimestamp(),
        feed: "REALTIME",
        delayMinutes: null,
        feedNote: null,
      };
      return { quote, meta: { endpoint: `https://${key}.test/quote`, httpStatus: 200, payloadHash: `h${calls[key]}`, fetchedAt: new Date().toISOString() } };
    },
  };
}

vi.mock("@/lib/providers/registry", () => ({
  quoteProvidersFor: () => [fake("fake-primary"), fake("fake-secondary")],
  providerStatuses: () => [],
}));

const { db } = await import("@/server/db");
const { getQuoteView } = await import("@/server/quotes");

let securityId = "";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const exchange = await db.exchange.upsert({
    where: { code: "NASDAQ" },
    create: { code: "NASDAQ", mic: "XNAS", name: "Nasdaq", market: "US", country: "US", currency: "USD", timezone: "America/New_York" },
    update: {},
  });
  await db.security.deleteMany({ where: { ticker: "ZZTEST" } });
  securityId = (await db.security.create({ data: { ticker: "ZZTEST", name: "Integration test security (synthetic)", exchangeId: exchange.id } })).id;
});

afterAll(async () => {
  await db.dataFetch.deleteMany({ where: { securityId } });
  await db.security.deleteMany({ where: { id: securityId } });
  await db.dataSource.deleteMany({ where: { key: { in: ["fake-primary", "fake-secondary"] } } });
  await db.$disconnect();
});

beforeEach(() => {
  scripts["fake-primary"] = { price: 100 };
  scripts["fake-secondary"] = { price: 100 };
});

describe("quote service", () => {
  it("fetches on page open, records provenance, and cross-checks with the second provider", async () => {
    const v = await getQuoteView(securityId);
    expect(v.servedFrom).toBe("provider");
    expect(v.decision).toBe("NO_CACHE");
    expect(v.provider?.key).toBe("fake-primary");
    expect(v.price).toBe(100);
    // While the market is open the fake quote is stamped "now", so allow the few ms the call took.
    expect(Math.abs(Date.parse(v.sourceTimestamp!) - Date.parse(sessionTimestamp()))).toBeLessThan(5_000);
    expect(["FRESH", "LAST_CLOSE"]).toContain(v.status);
    expect(v.verification.status).toBe("VERIFIED");
    expect(calls["fake-primary"]).toBe(1);
    const fetches = await db.dataFetch.findMany({ where: { securityId, dataset: "quote" } });
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toMatchObject({ status: "SUCCESS", httpStatus: 200, endpoint: "https://fake-primary.test/quote" });
  });

  it("serves the cache within the TTL without calling the provider", async () => {
    const before = calls["fake-primary"];
    const v = await getQuoteView(securityId);
    expect(v.servedFrom).toBe("cache");
    expect(v.decision).toBe("CACHE_FRESH");
    expect(v.attempts).toHaveLength(0);
    expect(calls["fake-primary"]).toBe(before);
  });

  it("Refresh Now makes a new provider request with a new fetch record", async () => {
    await wait(2100); // past the 2 s spam guard
    const before = calls["fake-primary"];
    const count = await db.dataFetch.count({ where: { securityId, dataset: "quote" } });
    scripts["fake-primary"] = { price: 101 };
    scripts["fake-secondary"] = { price: 101 };
    const v = await getQuoteView(securityId, { force: true });
    expect(v.decision).toBe("FORCED");
    expect(v.servedFrom).toBe("provider");
    expect(v.price).toBe(101);
    expect(calls["fake-primary"]).toBe(before + 1);
    expect(await db.dataFetch.count({ where: { securityId, dataset: "quote" } })).toBe(count + 1);
    expect(v.attempts[0]).toMatchObject({ provider: "fake-primary", ok: true });
  });

  it("falls back to the secondary provider when the primary fails", async () => {
    await wait(2100);
    scripts["fake-primary"] = { price: 0, fail: true };
    scripts["fake-secondary"] = { price: 102 };
    const v = await getQuoteView(securityId, { force: true });
    expect(v.attempts.map((a) => [a.provider, a.ok])).toEqual([
      ["fake-primary", false],
      ["fake-secondary", true],
    ]);
    expect(v.provider?.key).toBe("fake-secondary");
    expect(v.price).toBe(102);
    expect(v.status).not.toBe("CACHED");
  });

  it("preserves the last verified value when every provider fails", async () => {
    await wait(2100);
    scripts["fake-primary"] = { price: 0, fail: true };
    scripts["fake-secondary"] = { price: 0, fail: true };
    const v = await getQuoteView(securityId, { force: true });
    expect(v.attempts.every((a) => !a.ok)).toBe(true);
    expect(v.servedFrom).toBe("cache");
    expect(v.price).toBe(102);
    expect(v.status).toBe("CACHED");
    expect(v.lastFailedRefresh?.error).toContain("HTTP 503");
    // Automatic refreshes back off instead of hammering a failing provider.
    expect((await getQuoteView(securityId)).decision).toBe("FAILURE_BACKOFF");
  });

  it("records a conflict when the independent provider disagrees", async () => {
    await wait(2100);
    scripts["fake-primary"] = { price: 110 };
    scripts["fake-secondary"] = { price: 100 };
    const v = await getQuoteView(securityId, { force: true });
    expect(v.verification.status).toBe("CONFLICT");
    const open = await db.dataVerification.findMany({ where: { securityId, dataset: "quote", resolvedAt: null } });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: "CONFLICT", primarySource: "fake-primary", secondarySource: "fake-secondary" });
  });
});
