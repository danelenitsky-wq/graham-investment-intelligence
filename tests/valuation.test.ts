import { describe, expect, it } from "vitest";
import { grahamGrowthFormula, grahamNumber, historicalEpsGrowth, marginOfSafety, netNetValue, valueWithGraham } from "@/lib/valuation/graham";
import { bondYieldAdjustedFormula, inflationAdjustedSize, modernMetrics } from "@/lib/valuation/modern";
import { healthyCompany, year } from "./helpers";

describe("Graham valuation (1973)", () => {
  it("applies V = E × (8.5 + 2G)", () => {
    const v = grahamGrowthFormula({ earnings: 3, growthPercent: 5 });
    expect(v.status).toBe("OK");
    expect(v.value).toBeCloseTo(3 * 18.5);
    expect(v.methodology).toBe("GRAHAM_1973");
    expect(v.chapter).toBe(11);
  });

  it("refuses to value non-positive earnings", () => {
    expect(grahamGrowthFormula({ earnings: -1, growthPercent: 5 }).status).toBe("NOT_MEANINGFUL");
    expect(grahamGrowthFormula({ earnings: null, growthPercent: 5 }).status).toBe("INSUFFICIENT_DATA");
  });

  it("computes the Graham number √(22.5 × E × B)", () => {
    expect(grahamNumber({ earnings: 4, bookValuePerShare: 40 }).value).toBeCloseTo(Math.sqrt(22.5 * 160));
    expect(grahamNumber({ earnings: 4, bookValuePerShare: -1 }).status).toBe("NOT_MEANINGFUL");
  });

  it("computes NCAV per share net of all liabilities and preferred", () => {
    const v = netNetValue(year(2024, { currentAssets: 1000, totalLiabilities: 400, preferredStock: 100, sharesOutstanding: 10 }));
    expect(v.value).toBe(50);
    expect(v.inputs.twoThirds).toBeCloseTo(33.333, 2);
  });

  it("margin of safety is relative to value", () => {
    expect(marginOfSafety(100, 70)).toBeCloseTo(0.3);
    expect(marginOfSafety(null, 70)).toBeNull();
  });

  it("derives historical growth from 3-year averages", () => {
    const annual = healthyCompany(2024, 12);
    // FY2013-2024, EPS 2.00..4.75; end avg (4.25+4.5+4.75)/3 = 4.5; start FY2015-17 (2.5+2.75+3)/3 = 2.75; 7 years apart
    expect(historicalEpsGrowth(annual)).toBeCloseTo(Math.pow(4.5 / 2.75, 1 / 7) - 1, 10);
  });

  it("lets the user override the growth assumption", () => {
    const annual = healthyCompany(2024, 12);
    const v = valueWithGraham({ annual, price: 50, growthPercentOverride: 0 });
    expect(v.growthSource).toBe("USER");
    expect(v.estimates[0].value).toBeCloseTo(4.5 * 8.5);
    expect(v.marginsOfSafety["graham.growthFormula"]).toBeCloseTo((38.25 - 50) / 38.25);
  });
});

describe("modern extensions", () => {
  it("requires a user-supplied bond yield for the 4.4/Y formula", () => {
    expect(bondYieldAdjustedFormula({ earnings: 3, growthPercent: 5, aaaYieldPercent: null }).reason).toBe("missingBondYield");
    const v = bondYieldAdjustedFormula({ earnings: 3, growthPercent: 5, aaaYieldPercent: 5.5 });
    expect(v.methodology).toBe("MODERN_EXTENSION");
    expect(v.value).toBeCloseTo((3 * 18.5 * 4.4) / 5.5);
  });

  it("scales the size threshold by CPI only when CPI is provided", () => {
    const annual = [year(2024, { revenue: 500_000_000 })];
    expect(inflationAdjustedSize({ annual, isUtility: false, currentCpi: null }).status).toBe("INSUFFICIENT_DATA");
    const r = inflationAdjustedSize({ annual, isUtility: false, currentCpi: 41.8 * 6 });
    expect(r.measured.thresholdUsd).toBeCloseTo(600_000_000);
    expect(r.status).toBe("FAIL");
  });

  it("computes free cash flow and yields", () => {
    const m = modernMetrics({
      annual: [year(2024, { operatingCashFlow: 120, capitalExpenditures: 20, dilutedShares: 10, netIncome: 80, stockholdersEquity: 400 })],
      price: 50,
      normalEarnings: 8,
      aaaYieldPercent: 5,
    });
    expect(m.freeCashFlow).toBe(100);
    expect(m.freeCashFlowYield).toBeCloseTo(10 / 50);
    expect(m.earningsYield).toBeCloseTo(0.16);
    expect(m.earningsYieldSpreadOverAaa).toBeCloseTo(0.11);
    expect(m.returnOnEquity).toBeCloseTo(0.2);
  });
});
