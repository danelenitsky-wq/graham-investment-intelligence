import { describe, expect, it } from "vitest";
import { analyzeGraham } from "@/lib/graham";
import {
  buildValuationDashboard,
  compareToPrice,
  defensiveCeiling,
  enterprisingCeiling,
  grahamNumberCeiling,
  marginOfSafety,
  marginOfSafetyPercent,
  netNetCeiling,
  resolvePriceContext,
  type PriceInfo,
} from "@/lib/valuation/engine";
import {
  buildIntrinsicBase,
  computeIntrinsicValue,
  dcfValue,
  defaultAssumptions,
  normalizedEarningsValue,
  sensitivityAnalysis,
  type IntrinsicAssumptions,
} from "@/lib/valuation/intrinsic";
import { healthyCompany, year } from "./helpers";

const quote = (over: Partial<PriceInfo> = {}): PriceInfo => ({
  value: 50,
  currency: "USD",
  date: "2026-11-04",
  timestamp: "2026-11-04T21:00:00Z",
  source: "Tiingo",
  quoteStatus: "LAST_CLOSE",
  ...over,
});

describe("Graham Number", () => {
  it("is √(22.5 × avg EPS × BVPS)", () => {
    const g = grahamNumberCeiling({ averageEps: 4, bookValuePerShare: 40 });
    expect(g.status).toBe("ESTABLISHED");
    expect(g.value).toBeCloseTo(Math.sqrt(22.5 * 4 * 40), 10);
    expect(g.verification).toBe("NOT_A_GRAHAM_RULE");
  });

  it("is not established for negative EPS or negative book value", () => {
    expect(grahamNumberCeiling({ averageEps: -1, bookValuePerShare: 40 })).toMatchObject({ status: "NOT_ESTABLISHED", value: null, reason: "nonPositiveEarnings" });
    expect(grahamNumberCeiling({ averageEps: 4, bookValuePerShare: -5 })).toMatchObject({ status: "NOT_ESTABLISHED", value: null, reason: "nonPositiveBookValue" });
    expect(grahamNumberCeiling({ averageEps: null, bookValuePerShare: 40 }).reason).toBe("missingEarnings");
  });
});

describe("defensive price ceiling", () => {
  it("keeps P/E ≤ 15 as a separate limit: the Graham Number alone does not qualify a price", () => {
    // BVPS (120) > 10 × EPS (45): the Graham Number (≈110) is above 15 × EPS (67.5).
    const c = defensiveCeiling({ averageEps: 4.5, bookValuePerShare: 120 });
    expect(c.value).toBeCloseTo(67.5, 10);
    expect(c.binding).toBe("peLimit");
    const gn = c.components.find((x) => x.key === "grahamNumber")!.value!;
    expect(gn).toBeGreaterThan(c.value!);
  });

  it("is the Graham Number when the asset limit binds through P/E × P/B ≤ 22.5", () => {
    // BVPS (20) < 10 × EPS (40): 1.5 × BVPS = 30 < GN = √(22.5·4·20) ≈ 42.43 < 15 × EPS = 60
    const c = defensiveCeiling({ averageEps: 4, bookValuePerShare: 20 });
    expect(c.value).toBeCloseTo(Math.sqrt(22.5 * 4 * 20), 10);
    expect(c.binding).toBe("grahamNumber");
  });

  it("at the ceiling both D6 and D7 hold; just above it one fails", () => {
    for (const [e, b] of [
      [4, 20],
      [4.5, 120],
      [2, 20],
    ]) {
      const c = defensiveCeiling({ averageEps: e, bookValuePerShare: b }).value!;
      const ok = (p: number) => p / e <= 15 + 1e-9 && (p / b <= 1.5 + 1e-9 || (p / e) * (p / b) <= 22.5 + 1e-9);
      expect(ok(c)).toBe(true);
      expect(ok(c * 1.001)).toBe(false);
    }
  });

  it("is not established for negative EPS, negative or missing book value", () => {
    expect(defensiveCeiling({ averageEps: -0.5, bookValuePerShare: 20 })).toMatchObject({ status: "NOT_ESTABLISHED", reason: "nonPositiveEarnings", value: null });
    expect(defensiveCeiling({ averageEps: 3, bookValuePerShare: -2 })).toMatchObject({ status: "NOT_ESTABLISHED", reason: "nonPositiveBookValue", value: null });
    expect(defensiveCeiling({ averageEps: 3, bookValuePerShare: null })).toMatchObject({ status: "NOT_ESTABLISHED", reason: "missingBookValue" });
  });
});

describe("enterprising price ceiling", () => {
  it("is min(10.8 × avg EPS, 1.2 × NTAPS) and carries the E6 UNVERIFIED flag", () => {
    const c = enterprisingCeiling({ averageEps: 4.5, tangibleBookValuePerShare: 120 });
    expect(c.value).toBeCloseTo(48.6, 10);
    expect(c.binding).toBe("earningsLimit");
    expect(c.verification).toBe("UNVERIFIED");
    expect(c.components.find((x) => x.ruleId === "E6")!.verification).toBe("UNVERIFIED");
    expect(c.strict).toBe(false);
  });

  it("marks the tangible-asset limit as strict (price must be below 120% of NTAPS)", () => {
    const c = enterprisingCeiling({ averageEps: 10, tangibleBookValuePerShare: 20 });
    expect(c.value).toBeCloseTo(24, 10);
    expect(c.binding).toBe("tangibleLimit");
    expect(c.strict).toBe(true);
    expect(compareToPrice(c.value, 24, c.strict).withinThreshold).toBe(false);
    expect(compareToPrice(c.value, 23.99, c.strict).withinThreshold).toBe(true);
  });

  it("is not established for negative EPS or negative tangible book", () => {
    expect(enterprisingCeiling({ averageEps: -1, tangibleBookValuePerShare: 20 }).reason).toBe("nonPositiveEarnings");
    expect(enterprisingCeiling({ averageEps: 2, tangibleBookValuePerShare: -3 }).reason).toBe("nonPositiveTangibleBook");
  });
});

describe("Net-Net", () => {
  it("computes the two-thirds NCAV threshold, flagged UNVERIFIED", () => {
    const c = netNetCeiling({ ncavPerShare: 30 });
    expect(c.value).toBeCloseTo(20, 10);
    expect(c.verification).toBe("UNVERIFIED");
  });

  it("has no threshold when NCAV is negative or missing", () => {
    expect(netNetCeiling({ ncavPerShare: -4 })).toMatchObject({ status: "NOT_ESTABLISHED", value: null, reason: "nonPositiveNcav" });
    expect(netNetCeiling({ ncavPerShare: null }).reason).toBe("missingNcav");
  });
});

describe("dashboard from the Graham engine", () => {
  const annual = healthyCompany(2024, 12);
  const graham = analyzeGraham({ annual, price: { value: 50, date: "2025-03-01", currency: "USD" } });
  const price = resolvePriceContext({ quote: quote({ date: "2025-03-01" }), statementCurrency: "USD", today: "2025-03-02", staleAfterDays: 7 });
  const d = buildValuationDashboard({ graham, price, currency: "USD" });

  it("reads the same inputs the rules used", () => {
    // avg EPS FY2022-24 = (4.25 + 4.5 + 4.75)/3 = 4.5; BVPS = 1.2B / 10M = 120; NCAV/share = (900M − 800M)/10M = 10
    expect(d.grahamNumber.ceiling.value).toBeCloseTo(Math.sqrt(22.5 * 4.5 * 120), 8);
    expect(d.defensive.ceiling.value).toBeCloseTo(67.5, 8);
    expect(d.enterprising.ceiling.value).toBeCloseTo(48.6, 8);
    expect(d.netNet.ncavPerShare).toBeCloseTo(10, 8);
    expect(d.netNet.ceiling.value).toBeCloseTo(20 / 3, 8);
  });

  it("computes the change required to reach each threshold", () => {
    expect(d.defensive.comparison.changeRequired).toBeCloseTo(67.5 / 50 - 1, 10);
    expect(d.defensive.comparison.withinThreshold).toBe(true);
    expect(d.enterprising.comparison.changeRequired).toBeCloseTo(48.6 / 50 - 1, 10);
    expect(d.enterprising.comparison.withinThreshold).toBe(false);
    expect(d.netNet.comparison.changeRequired).toBeCloseTo(10 / 1.5 / 50 - 1, 10);
  });

  it("reports the non-price criteria next to the ceilings", () => {
    expect(d.defensive.otherCriteria).not.toBeNull();
    expect(d.defensive.otherCriteria!.open.every((r) => !["D6", "D7"].includes(r.id))).toBe(true);
  });

  it("follows the engine's sector applicability for banks", () => {
    const bank = analyzeGraham({ annual, price: null, classification: { industryClass: "BANK", basis: "SIC", sicCode: "6021" } });
    const b = buildValuationDashboard({ graham: bank, price, currency: "USD" });
    // D6/D7 apply to banks; E7 and Net-Net do not.
    expect(b.defensive.ceiling.status).toBe("ESTABLISHED");
    expect(b.enterprising.ceiling.status).toBe("NOT_APPLICABLE");
    expect(b.enterprising.ceiling.value).toBeNull();
    expect(b.netNet.ceiling.status).toBe("NOT_APPLICABLE");
    expect(b.netNet.ceiling.value).toBeNull();
  });

  it("does not fabricate ceilings when fundamentals are incomplete", () => {
    const partial = [year(2024, { epsDiluted: 3, currentAssets: 100 })];
    const g = analyzeGraham({ annual: partial, price: null });
    const p = buildValuationDashboard({ graham: g, price, currency: "USD" });
    for (const k of ["grahamNumber", "defensive", "enterprising", "netNet"] as const) {
      expect(p[k].ceiling.value).toBeNull();
      expect(p[k].comparison.changeRequired).toBeNull();
    }
  });
});

describe("price inputs", () => {
  it("uses a current last-close quote as the CURRENT basis", () => {
    const p = resolvePriceContext({ quote: quote(), statementCurrency: "USD", today: "2026-11-05", staleAfterDays: 7 });
    expect(p).toMatchObject({ basis: "CURRENT", comparable: 50, warning: null, ageDays: 1 });
  });

  it("labels a stale quote as a HISTORICAL basis but still compares", () => {
    const p = resolvePriceContext({ quote: quote({ quoteStatus: "STALE" }), statementCurrency: "USD", today: "2026-11-05", staleAfterDays: 7 });
    expect(p.basis).toBe("HISTORICAL");
    expect(p.warning).toBe("staleQuote");
    expect(p.comparable).toBe(50);
  });

  it("treats an old price as historical even if its status was acceptable", () => {
    const p = resolvePriceContext({ quote: quote({ date: "2026-09-01" }), statementCurrency: "USD", today: "2026-11-05", staleAfterDays: 7 });
    expect(p).toMatchObject({ basis: "HISTORICAL", warning: "agedPrice" });
  });

  it("falls back to the last stored close, labelled historical", () => {
    const p = resolvePriceContext({ quote: null, storedClose: { value: 44, date: "2026-10-30", currency: "USD", source: "Tiingo" }, statementCurrency: "USD", today: "2026-11-05", staleAfterDays: 7 });
    expect(p).toMatchObject({ basis: "HISTORICAL", warning: "storedCloseFallback", comparable: 44 });
  });

  it("reports UNAVAILABLE with no price and makes no comparison", () => {
    const p = resolvePriceContext({ quote: null, statementCurrency: "USD", today: "2026-11-05", staleAfterDays: 7 });
    expect(p).toMatchObject({ basis: "UNAVAILABLE", comparable: null, warning: "noPrice" });
    expect(compareToPrice(67.5, p.comparable)).toEqual({ changeRequired: null, withinThreshold: null });
  });

  it("refuses to compare a price in another currency", () => {
    const p = resolvePriceContext({ quote: quote({ currency: "ILS" }), statementCurrency: "USD", today: "2026-11-05", staleAfterDays: 7 });
    expect(p.comparable).toBeNull();
    expect(p.warning).toBe("currencyMismatch");
  });
});

describe("margin of safety", () => {
  const established = { status: "ESTABLISHED", value: 100 } as Parameters<typeof marginOfSafety>[0];

  it("is (IV − P) / IV × 100", () => {
    expect(marginOfSafetyPercent(100, 70)).toBeCloseTo(30, 10);
    expect(marginOfSafetyPercent(100, 120)).toBeCloseTo(-20, 10);
    expect(marginOfSafetyPercent(null, 70)).toBeNull();
    expect(marginOfSafetyPercent(-10, 70)).toBeNull();
  });

  it("compares against the configurable target (default 30%)", () => {
    const m = marginOfSafety(established, 65);
    expect(m.target).toBe(0.3);
    expect(m.percent).toBeCloseTo(35, 10);
    expect(m.targetPrice).toBeCloseTo(70, 10);
    expect(m.meetsTarget).toBe(true);
    const strict = marginOfSafety(established, 65, 0.4);
    expect(strict.meetsTarget).toBe(false);
    expect(strict.changeRequired).toBeCloseTo(60 / 65 - 1, 10);
  });

  it("is NOT ESTABLISHED without a defensible intrinsic value or a comparable price", () => {
    expect(marginOfSafety(null, 50)).toMatchObject({ status: "NOT_ESTABLISHED", reason: "noIntrinsicValue", percent: null });
    expect(marginOfSafety({ status: "NOT_ESTABLISHED", value: null } as Parameters<typeof marginOfSafety>[0], 50).status).toBe("NOT_ESTABLISHED");
    expect(marginOfSafety(established, null)).toMatchObject({ status: "NOT_ESTABLISHED", reason: "noComparablePrice", targetPrice: 70 });
  });
});

describe("intrinsic value (modern extension)", () => {
  const base = buildIntrinsicBase(
    healthyCompany(2024, 10, (fy) => ({ revenue: 1_000_000_000 * Math.pow(1.05, fy - 2015), operatingCashFlow: 50_000_000, capitalExpenditures: 20_000_000 })),
    "INDUSTRIAL",
  );
  const a: IntrinsicAssumptions = { enabled: true, method: "DCF", revenueGrowth: 0.03, profitMargin: 0.05, discountRate: 0.1, terminalGrowth: 0.02, normalizationYears: 5, shareDilution: 0, projectionYears: 10 };

  it("derives conservative defaults from history", () => {
    const d = defaultAssumptions(base);
    expect(d.historical.revenueCagr).toBeCloseTo(0.05, 8);
    expect(d.sources.revenueGrowth).toBe("HISTORICAL");
    // The normalized net-income margin is used even though the FCF margin is lower.
    expect(d.historical.fcfMargin!).toBeLessThan(d.historical.netMargin!);
    expect(d.marginBasis).toBe("NET_INCOME");
    expect(d.assumptions.profitMargin).toBeCloseTo(d.historical.netMargin!, 12);
    expect(d.assumptions.shareDilution).toBe(0);
  });

  it("matches a hand-computed DCF", () => {
    const out = dcfValue(100, 10, { ...a, revenueGrowth: 0, profitMargin: 0.1, projectionYears: 2 });
    // EPS 1 each year; PV = 1/1.1 + 1/1.21 + (1 × 1.02 / 0.08) / 1.21
    expect(out.value).toBeCloseTo(1 / 1.1 + 1 / 1.21 + 12.75 / 1.21, 10);
  });

  it("capitalises normalized earnings net of dilution", () => {
    expect(normalizedEarningsValue(5, { ...a, terminalGrowth: 0 }).value).toBeCloseTo(50, 10);
    expect(normalizedEarningsValue(-1, a).value).toBeNull();
  });

  it("is NOT ESTABLISHED when inputs cannot support a value", () => {
    expect(computeIntrinsicValue(base, { ...a, profitMargin: -0.02 })).toMatchObject({ status: "NOT_ESTABLISHED", reason: "nonPositiveMargin", value: null });
    expect(computeIntrinsicValue(base, { ...a, discountRate: 0.02, terminalGrowth: 0.03 }).reason).toBe("discountNotAboveTerminal");
    expect(computeIntrinsicValue(base, { ...a, enabled: false }).status).toBe("DISABLED");
    expect(computeIntrinsicValue(buildIntrinsicBase(healthyCompany(2024, 10), "BANK"), a).reason).toBe("financialIssuer");
    expect(computeIntrinsicValue(buildIntrinsicBase([year(2024, { revenue: 10, netIncome: 1, dilutedShares: 1 })], "INDUSTRIAL"), a).reason).toBe("insufficientHistory");
    const loss = buildIntrinsicBase(healthyCompany(2024, 10, () => ({ epsDiluted: -1 })), "INDUSTRIAL");
    expect(computeIntrinsicValue(loss, { ...a, method: "NORMALIZED_EARNINGS" }).reason).toBe("nonPositiveNormalizedEarnings");
  });

  it("produces a valuation range around the base case", () => {
    const r = computeIntrinsicValue(base, a);
    expect(r.status).toBe("ESTABLISHED");
    expect(r.low!).toBeLessThan(r.value!);
    expect(r.high!).toBeGreaterThan(r.value!);
    expect(r.projection).toHaveLength(10);
    expect(r.terminalShare!).toBeGreaterThan(0);
    expect(r.terminalShare!).toBeLessThan(1);
  });
});

describe("sensitivity analysis", () => {
  const base = buildIntrinsicBase(healthyCompany(2024, 10), "INDUSTRIAL");
  const a: IntrinsicAssumptions = { enabled: true, method: "DCF", revenueGrowth: 0.03, profitMargin: 0.05, discountRate: 0.09, terminalGrowth: 0.02, normalizationYears: 5, shareDilution: 0.01, projectionYears: 10 };

  it("builds a 5×5 grid centred on the base case", () => {
    const s = sensitivityAnalysis(base, a)!;
    expect(s.rows).toEqual([0.07, 0.08, 0.09, 0.1, 0.11]);
    expect(s.cols).toEqual([-0.01, 0.01, 0.03, 0.05, 0.07]);
    expect(s.values[s.baseRow][s.baseCol]).toBeCloseTo(computeIntrinsicValue(base, a).value!, 10);
  });

  it("value falls as the discount rate rises and rises with growth", () => {
    const s = sensitivityAnalysis(base, a)!;
    for (let j = 0; j < s.cols.length; j++)
      for (let i = 1; i < s.rows.length; i++) expect(s.values[i][j]!).toBeLessThan(s.values[i - 1][j]!);
    for (let i = 0; i < s.rows.length; i++)
      for (let j = 1; j < s.cols.length; j++) expect(s.values[i][j]!).toBeGreaterThan(s.values[i][j - 1]!);
  });

  it("leaves cells empty where the discount rate does not exceed terminal growth", () => {
    const s = sensitivityAnalysis(base, { ...a, method: "NORMALIZED_EARNINGS", discountRate: 0.04, terminalGrowth: 0.03, shareDilution: 0 })!;
    expect(s.colKey).toBe("terminalGrowth");
    // rows 0.02, 0.03 are at or below terminal growth 0.03 → null
    expect(s.values[0][2]).toBeNull();
    expect(s.values[1][2]).toBeNull();
    expect(s.values[2][2]).not.toBeNull();
  });

  it("returns null when the model cannot be computed", () => {
    expect(sensitivityAnalysis(buildIntrinsicBase([], "INDUSTRIAL"), a)).toBeNull();
  });
});
