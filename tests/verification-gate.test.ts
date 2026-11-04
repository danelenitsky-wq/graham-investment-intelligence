import { describe, expect, it } from "vitest";
import { compareFigures, summarizeVerification, verifyPeriods, verifyQuote, type SourcedPeriod } from "@/lib/verification";
import { evaluateDataSufficiency, type GateInput } from "@/lib/freshness/gate";

const sec = (over: Partial<SourcedPeriod["values"]> = {}, periodEnd = "2025-09-27"): SourcedPeriod => ({
  periodEnd,
  fiscalYear: 2025,
  fiscalPeriod: "FY",
  reference: "0000320193-25-000079",
  values: {
    revenue: 400_000_000_000,
    netIncome: 100_000_000_000,
    epsDiluted: 6.5,
    totalAssets: 360_000_000_000,
    stockholdersEquity: 70_000_000_000,
    operatingCashFlow: 110_000_000_000,
    ...over,
  },
});

describe("figure comparison", () => {
  it("verifies within relative or absolute tolerance", () => {
    expect(compareFigures(100, 100.5, { rel: 0.01, abs: 0 }).status).toBe("VERIFIED");
    expect(compareFigures(1.0, 1.01, { rel: 0, abs: 0.015 }).status).toBe("VERIFIED");
    expect(compareFigures(100, 103, { rel: 0.01, abs: 0 }).status).toBe("CONFLICT");
  });
});

describe("statement verification (conflicting data)", () => {
  it("verifies matching figures from an independent source", () => {
    const r = verifyPeriods([sec()], [sec({}, "2025-09-30")]); // vendor uses month-end: within skew
    expect(r.every((c) => c.status === "VERIFIED")).toBe(true);
    expect(summarizeVerification(r)).toBe("VERIFIED");
  });

  it("flags a material discrepancy as CONFLICT and keeps the primary value", () => {
    const r = verifyPeriods([sec()], [sec({ netIncome: 93_000_000_000 })]);
    const ni = r.find((c) => c.metric === "netIncome")!;
    expect(ni.status).toBe("CONFLICT");
    expect(ni.primaryValue).toBe(100_000_000_000);
    expect(ni.secondaryValue).toBe(93_000_000_000);
    expect(ni.relDiff).toBeCloseTo(0.07, 3);
    expect(summarizeVerification(r)).toBe("CONFLICT");
  });

  it("marks metrics without an independent value as SINGLE_SOURCE (never as verified)", () => {
    const r = verifyPeriods([sec()], [sec({ operatingCashFlow: undefined })]);
    expect(r.find((c) => c.metric === "operatingCashFlow")!.status).toBe("SINGLE_SOURCE");
    expect(verifyPeriods([sec()], []).every((c) => c.status === "SINGLE_SOURCE")).toBe(true);
  });

  it("does not match periods with different fiscal labels or distant period ends", () => {
    const q: SourcedPeriod = { ...sec(), fiscalPeriod: "Q4" };
    expect(verifyPeriods([sec()], [q]).every((c) => c.status === "SINGLE_SOURCE")).toBe(true);
    expect(verifyPeriods([sec()], [sec({}, "2024-09-28")]).every((c) => c.status === "SINGLE_SOURCE")).toBe(true);
  });

  it("accepts a vendor EPS that is not split-adjusted when the split explains the gap", () => {
    // SEC value adjusted for a later 4:1 split; vendor reports the original EPS.
    const r = verifyPeriods([sec({ epsDiluted: 1.5 })], [sec({ epsDiluted: 6.0 })], { splitFactorAfter: () => 4 });
    const eps = r.find((c) => c.metric === "epsDiluted")!;
    expect(eps.status).toBe("VERIFIED");
    expect(eps.splitAdjusted).toBe(true);
  });
});

describe("quote verification", () => {
  const primary = { provider: "fmp", price: 230.1, sourceTimestamp: "2026-11-04T15:00:00Z", previousClose: 228 };
  it("compares prices observed close together", () => {
    expect(verifyQuote(primary, { provider: "tiingo", price: 230.2, sourceTimestamp: "2026-11-04T15:00:30Z" }).status).toBe("VERIFIED");
    expect(verifyQuote(primary, { provider: "tiingo", price: 240, sourceTimestamp: "2026-11-04T15:00:30Z" }).status).toBe("CONFLICT");
  });
  it("falls back to previous closes when timestamps are far apart", () => {
    const r = verifyQuote(primary, { provider: "tiingo", price: 231, sourceTimestamp: "2026-11-04T14:00:00Z", previousClose: 228 });
    expect(r).toMatchObject({ status: "VERIFIED", comparedField: "previousClose" });
  });
  it("is SINGLE_SOURCE without a second provider", () => {
    expect(verifyQuote(primary, null).status).toBe("SINGLE_SOURCE");
  });
});

describe("data sufficiency gate (INSUFFICIENT VERIFIED DATA)", () => {
  const ok: GateInput = {
    quoteStatus: "LAST_CLOSE",
    fundamentals: { level: "FRESH", asOf: "2025-09-27", ageDays: 30, isDevFixture: false },
    latestAnnual: { revenue: 1, netIncome: 1, epsDiluted: 1, totalAssets: 1, currentAssets: 1, currentLiabilities: 1, stockholdersEquity: 1 },
    conflicts: [],
    newerFiling: null,
    quoteConflict: false,
    usesDevFixtureData: false,
  };

  it("passes with complete, current, consistent data", () => {
    expect(evaluateDataSufficiency(ok).sufficient).toBe(true);
    expect(evaluateDataSufficiency({ ...ok, quoteStatus: "CACHED" }).sufficient).toBe(true);
  });

  it("fails on a stale or unavailable price", () => {
    expect(evaluateDataSufficiency({ ...ok, quoteStatus: "STALE" })).toMatchObject({ sufficient: false, stale: ["price"] });
    expect(evaluateDataSufficiency({ ...ok, quoteStatus: "UNAVAILABLE" })).toMatchObject({ sufficient: false, missing: ["price"] });
  });

  it("fails on missing required fields", () => {
    const r = evaluateDataSufficiency({ ...ok, latestAnnual: { ...ok.latestAnnual, currentLiabilities: undefined } });
    expect(r.sufficient).toBe(false);
    expect(r.missing).toContain("concept:currentLiabilities");
  });

  it("fails on conflicting values", () => {
    const r = evaluateDataSufficiency({ ...ok, conflicts: [{ metric: "netIncome", fiscalYear: 2025, fiscalPeriod: "FY" }] });
    expect(r).toMatchObject({ sufficient: false, conflicting: ["netIncome FY2025"] });
    expect(evaluateDataSufficiency({ ...ok, quoteConflict: true }).conflicting).toEqual(["price"]);
  });

  it("fails when a newer filing exists than the stored statements (API recency ≠ data recency)", () => {
    const r = evaluateDataSufficiency({ ...ok, newerFiling: { form: "10-Q", filedAt: "2026-10-31", accessionNumber: "x" } });
    expect(r).toMatchObject({ sufficient: false, stale: ["financials"], notes: ["NEWER_FILING_AVAILABLE"] });
  });

  it("fails on stale fundamentals and on development fixtures", () => {
    expect(evaluateDataSufficiency({ ...ok, fundamentals: { ...ok.fundamentals, level: "STALE" } }).sufficient).toBe(false);
    expect(evaluateDataSufficiency({ ...ok, usesDevFixtureData: true }).sufficient).toBe(false);
  });
});
