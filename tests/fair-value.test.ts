import { describe, expect, it } from "vitest";
import { buildFairValue, impliedRevenueGrowth, type FairValueInput } from "@/lib/valuation/fair-value";
import { valueWithGraham } from "@/lib/valuation/graham";
import { buildIntrinsicBase, computeIntrinsicValue, dcfValue, defaultAssumptions } from "@/lib/valuation/intrinsic";
import { ncavPerShare } from "@/lib/graham/metrics";
import type { IndustryClass } from "@/lib/graham/classification";
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { healthyCompany, year } from "./helpers";

/** Approximate NVIDIA-like history (USD, split-adjusted; synthetic test data shaped like FY2016–FY2025). */
function fastGrower(): AnnualFinancials[] {
  const rows: [number, number, number, number, number][] = [
    // fy, revenue (B), net income (B), OCF (B), capex (B)
    [2016, 5.01, 0.61, 1.18, 0.15],
    [2017, 6.91, 1.67, 1.67, 0.18],
    [2018, 9.71, 3.05, 3.5, 0.59],
    [2019, 11.72, 4.14, 3.74, 0.6],
    [2020, 10.92, 2.8, 4.76, 0.49],
    [2021, 16.68, 4.33, 5.82, 1.13],
    [2022, 26.91, 9.75, 9.11, 0.98],
    [2023, 26.97, 4.37, 5.64, 1.83],
    [2024, 60.92, 29.76, 28.09, 1.07],
    [2025, 130.5, 72.88, 64.09, 3.24],
  ];
  const shares = 24.8e9;
  return rows.map(([fy, rev, ni, ocf, capex]) =>
    year(fy, {
      revenue: rev * 1e9,
      netIncome: ni * 1e9,
      epsDiluted: (ni * 1e9) / shares,
      dilutedShares: shares,
      sharesOutstanding: shares,
      operatingCashFlow: ocf * 1e9,
      capitalExpenditures: capex * 1e9,
      currentAssets: 80e9,
      currentLiabilities: 18e9,
      totalLiabilities: 32e9,
      totalAssets: 111e9,
      stockholdersEquity: 79e9,
    }),
  );
}

function inputFor(annual: AnnualFinancials[], price: number | null, opts: { g?: number; industryClass?: IndustryClass } = {}): FairValueInput {
  const graham = valueWithGraham({ annual, price, growthPercentOverride: opts.g ?? null });
  const base = buildIntrinsicBase(annual, opts.industryClass ?? "INDUSTRIAL");
  const defaults = defaultAssumptions(base);
  return {
    intrinsic: computeIntrinsicValue(base, defaults.assumptions),
    graham,
    ncavPerShare: ncavPerShare(annual[annual.length - 1]),
    grahamNumber: 20.94,
    netNetThreshold: 2.09,
    price,
    currency: "USD",
    historicalRevenueGrowth: defaults.historical.revenueCagr,
  };
}

describe("bottom-line fair value", () => {
  it("for a fast grower, ignores the Net-Net threshold and the Graham Number and uses the DCF", () => {
    const fv = buildFairValue(inputFor(fastGrower(), 181));
    expect(fv.status).toBe("ESTABLISHED");
    const role = (id: string) => fv.models.find((m) => m.id === id)!.role;
    expect(role("dcf")).toBe("USED");
    expect(role("grahamFormula")).toBe("NOT_AVAILABLE"); // growth above the formula's 20% range
    expect(fv.models.find((m) => m.id === "grahamFormula")!.reason).toBe("growthAboveFormulaRange");
    expect(role("netNetThreshold")).toBe("NOT_A_VALUE");
    expect(role("grahamNumber")).toBe("NOT_A_VALUE");
    expect(role("ncav")).toBe("FALLBACK_ONLY");
    // Estimate is far above the $2.09 threshold.
    expect(fv.base!).toBeGreaterThan(20);
    expect(fv.low!).toBeLessThanOrEqual(fv.base!);
    expect(fv.high!).toBeGreaterThanOrEqual(fv.base!);
    expect(fv.gap!).toBeCloseTo((fv.base! - 181) / 181, 10);
    expect(fv.scenarios.total).toBeGreaterThan(0);
    expect(fv.scenarios.above).toBeLessThanOrEqual(fv.scenarios.total);
  });

  it("explains the gap with the revenue growth the price implies", () => {
    const input = inputFor(fastGrower(), 181);
    const fv = buildFairValue(input);
    const ig = fv.impliedGrowth;
    // Default growth = 5-year revenue CAGR (far above 30% here), capped at 30%.
    expect(ig.assumed).toBeCloseTo(0.3, 10);
    expect(ig.value).not.toBeNull();
    // Plugging the implied growth back into the DCF reproduces the price.
    const iv = input.intrinsic;
    const v = dcfValue(iv.inputs.baseRevenue!, iv.inputs.baseShares!, { ...iv.assumptions, revenueGrowth: ig.value! }).value!;
    expect(v).toBeCloseTo(181, 4);
  });

  it("defaults DCF growth to the company's own 5-year revenue CAGR", () => {
    const annual = healthyCompany(2024, 12, (fy) => ({ revenue: 1_000_000_000 * Math.pow(1.12, fy - 2013) }));
    const d = defaultAssumptions(buildIntrinsicBase(annual, "INDUSTRIAL"));
    expect(d.assumptions.normalizationYears).toBe(5);
    expect(d.assumptions.revenueGrowth).toBeCloseTo(0.12, 10);
    expect(d.sources.revenueGrowth).toBe("HISTORICAL");
  });

  it("blends the DCF and the growth formula with equal weight for a steady company", () => {
    const annual = healthyCompany(2024, 12);
    const input = inputFor(annual, 30);
    const fv = buildFairValue(input);
    const used = fv.models.filter((m) => m.role === "USED");
    expect(used.map((m) => m.id).sort()).toEqual(["dcf", "grahamFormula"]);
    expect(fv.base!).toBeCloseTo((used[0].value! + used[1].value!) / 2, 10);
    expect(fv.low).toBe(Math.min(...used.map((m) => m.low!)));
    expect(fv.high).toBe(Math.max(...used.map((m) => m.high!)));
    // 25 DCF grid points (some may be dropped) + 3 growth-formula variants.
    expect(fv.scenarios.total).toBeGreaterThanOrEqual(3);
    expect(fv.scenarios.values).toEqual([...fv.scenarios.values].sort((a, b) => a - b));
  });

  it("uses a user growth rate in the formula when given", () => {
    const fv = buildFairValue(inputFor(fastGrower(), 181, { g: 15 }));
    const gf = fv.models.find((m) => m.id === "grahamFormula")!;
    expect(gf.role).toBe("USED");
    expect(gf.reason).toBe("userGrowth");
  });

  it("falls back to NCAV only when no earnings model works", () => {
    const annual = healthyCompany(2024, 12, () => ({ netIncome: -5_000_000, epsDiluted: -0.5, revenue: 1_000_000_000 }));
    const fv = buildFairValue(inputFor(annual, 10));
    const ncav = fv.models.find((m) => m.id === "ncav")!;
    expect(ncav.role).toBe("USED");
    expect(fv.flags.assetBasedOnly).toBe(true);
    expect(fv.base).toBe(ncav.value);
  });

  it("establishes no value when no model fits, and no gap without a price", () => {
    const annual = healthyCompany(2024, 12, () => ({ netIncome: -5_000_000, epsDiluted: -0.5, currentAssets: 100, totalLiabilities: 900_000_000 }));
    expect(buildFairValue(inputFor(annual, 10)).status).toBe("NOT_ESTABLISHED");
    const noPrice = buildFairValue(inputFor(healthyCompany(), null));
    expect(noPrice.status).toBe("ESTABLISHED");
    expect(noPrice.gap).toBeNull();
    expect(noPrice.verdict).toBeNull();
    expect(noPrice.scenarios.total).toBe(0);
  });

  it("marks a price within ±10% of the estimate as near the estimate", () => {
    const input = inputFor(healthyCompany(), 30);
    const base = buildFairValue(input).base!;
    expect(buildFairValue({ ...input, price: base * 1.05 }).verdict).toBe("NEAR_ESTIMATE");
    expect(buildFairValue({ ...input, price: base * 0.7 }).verdict).toBe("BELOW_ESTIMATE");
  });
});

describe("heavy-investment company (AMZN-like)", () => {
  // Synthetic: profitable, but capex absorbs most of the operating cash flow in recent years.
  const annual = [2021, 2022, 2023, 2024, 2025].map((fy, i) => {
    const revenue = [470, 514, 575, 638, 717][i] * 1e9;
    const netIncome = [33.4, -2.7, 30.4, 59.2, 78][i] * 1e9;
    const capex = [61, 64, 53, 83, 132][i] * 1e9;
    const ocf = [46, 47, 85, 116, 140][i] * 1e9;
    const shares = 10.7e9;
    return year(fy, { revenue, netIncome, epsDiluted: netIncome / shares, dilutedShares: shares, sharesOutstanding: shares, operatingCashFlow: ocf, capitalExpenditures: capex, currentAssets: 190e9, currentLiabilities: 180e9, totalLiabilities: 330e9, totalAssets: 620e9, stockholdersEquity: 290e9 });
  });

  it("values the business on normalized net income, not on depressed free cash flow, and flags the gap", () => {
    const base = buildIntrinsicBase(annual, "INDUSTRIAL");
    const d = defaultAssumptions(base);
    expect(d.marginBasis).toBe("NET_INCOME");
    expect(d.historical.fcfMargin!).toBeLessThan(d.historical.netMargin! / 2);
    expect(d.fcfWellBelowEarnings).toBe(true);
    const fv = buildFairValue({ ...inputFor(annual, 261.82), fcfWellBelowEarnings: d.fcfWellBelowEarnings });
    expect(fv.flags.cashFlowBelowEarnings).toBe(true);
    // ~6.8% normalized margin on $717B revenue: several times the FCF-based ~$15.
    expect(fv.base!).toBeGreaterThan(60);
  });
});

describe("implied revenue growth", () => {
  it("reports when the price is beyond the search range", () => {
    const base = buildIntrinsicBase(fastGrower(), "INDUSTRIAL");
    const a = defaultAssumptions(base).assumptions;
    const iv = computeIntrinsicValue(base, a);
    expect(impliedRevenueGrowth(iv.inputs.baseRevenue!, iv.inputs.baseShares!, a, 1e7).outOfRange).toBe("ABOVE");
    expect(impliedRevenueGrowth(iv.inputs.baseRevenue!, iv.inputs.baseShares!, a, 0.01).outOfRange).toBe("BELOW");
  });
});
