import { describe, expect, it } from "vitest";
import { analyzeGraham } from "@/lib/graham";
import { computeInterimHealth, type QuarterInput } from "@/lib/interim";
import type { AnnualFinancials } from "@/lib/normalization/statements";

type V = AnnualFinancials["values"];

const annualYear = (fy: number, values: V): AnnualFinancials => ({ fiscalYear: fy, periodEnd: `${fy}-12-31`, currency: "USD", values });
const q = (fy: number, fp: string, periodEnd: string, values: V, currency = "USD"): QuarterInput => ({
  fiscalYear: fy,
  fiscalPeriod: fp,
  periodEnd,
  currency,
  filedAt: null,
  form: "10-Q",
  accessionNumber: null,
  values,
});

const balance: V = { currentAssets: 300, currentLiabilities: 100, longTermDebt: 100, stockholdersEquity: 500, cashAndEquivalents: 50, totalLiabilities: 300 };
const fy2024 = annualYear(2024, { revenue: 1000, operatingIncome: 200, netIncome: 120, epsDiluted: 1.2, operatingCashFlow: 150, ...balance });
// FY2024 quarters (calendar year), each a quarter of the annual figures.
const prior = [
  q(2024, "Q1", "2024-03-31", { revenue: 250, operatingIncome: 50, netIncome: 30, epsDiluted: 0.3, operatingCashFlow: 37.5 }),
  q(2024, "Q2", "2024-06-30", { revenue: 250, operatingIncome: 50, netIncome: 30, epsDiluted: 0.3, operatingCashFlow: 37.5 }),
  q(2024, "Q3", "2024-09-30", { revenue: 250, operatingIncome: 50, netIncome: 30, epsDiluted: 0.3, operatingCashFlow: 37.5 }),
];

describe("interim (latest quarter / TTM) health", () => {
  it("TTM = annual + YTD − prior-year YTD, and no flags when the business is steady", () => {
    const cur = [
      q(2025, "Q1", "2025-03-31", { revenue: 260, operatingIncome: 52, netIncome: 31, epsDiluted: 0.31, operatingCashFlow: 38, ...balance }),
    ];
    const h = computeInterimHealth([fy2024], [...prior, ...cur]);
    expect(h.status).toBe("OK");
    expect(h.quartersSinceAnnual).toBe(1);
    const rev = h.comparisons.find((c) => c.metric === "revenue")!;
    expect(rev.method).toBe("ANNUAL_PLUS_YTD");
    expect(rev.latest).toBe(1000 + 260 - 250);
    expect(rev.change).toBeCloseTo(0.01, 10);
    expect(h.comparisons.find((c) => c.metric === "epsDiluted")!.approximate).toBe(true);
    expect(h.flags).toEqual([]);
    expect(h.materialDeterioration).toBe(false);
  });

  it("flags material deterioration since the annual filing (income, cash flow, liquidity, debt)", () => {
    const weak: V = { currentAssets: 180, currentLiabilities: 120, longTermDebt: 200, stockholdersEquity: 400, cashAndEquivalents: 10 };
    const cur = [
      q(2025, "Q1", "2025-03-31", { revenue: 200, operatingIncome: 10, netIncome: -5, epsDiluted: -0.05, operatingCashFlow: 5 }),
      q(2025, "Q2", "2025-06-30", { revenue: 180, operatingIncome: -20, netIncome: -40, epsDiluted: -0.4, operatingCashFlow: -30, ...weak }),
    ];
    const h = computeInterimHealth([fy2024], [...prior, ...cur]);
    const codes = h.flags.map((f) => f.code);
    // Revenue 1000 + 380 − 500 = 880 (−12%).
    expect(h.comparisons.find((c) => c.metric === "revenue")!.latest).toBe(880);
    expect(codes).toContain("REVENUE_DECLINE");
    // Net income 120 − 45 − 60 = 15 (−87.5%), still positive: a decline, not "turned negative".
    expect(codes).toContain("NET_INCOME_DECLINE");
    expect(codes).toContain("OPERATING_INCOME_DECLINE"); // 200 − 10 − 100 = 90 (−55%)
    expect(codes).toContain("OPERATING_CASH_FLOW_DECLINE"); // 150 + (5 − 30) − 75 = 50 (−67%)
    expect(codes).toContain("CURRENT_RATIO_BELOW_REFERENCE"); // 3.0 → 1.5
    expect(codes).toContain("WORKING_CAPITAL_DECLINE"); // 200 → 60
    expect(codes).toContain("DEBT_INCREASE"); // 100 → 200
    expect(codes).toContain("EQUITY_DECLINE"); // 500 → 400 (−20%)
    expect(h.materialDeterioration).toBe(true);
  });

  it("detects a swing to losses as 'turned negative'", () => {
    const cur = [q(2025, "Q1", "2025-03-31", { revenue: 240, operatingIncome: -200, netIncome: -200, epsDiluted: -2, operatingCashFlow: -150, ...balance })];
    const h = computeInterimHealth([fy2024], [...prior, ...cur]);
    const codes = h.flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["OPERATING_INCOME_TURNED_NEGATIVE", "NET_INCOME_TURNED_NEGATIVE", "EPS_TURNED_NEGATIVE", "OPERATING_CASH_FLOW_TURNED_NEGATIVE"]));
    expect(codes).not.toContain("NET_INCOME_DECLINE");
  });

  it("never invents a TTM value: a missing prior-year quarter leaves it null", () => {
    const cur = [q(2025, "Q1", "2025-03-31", { revenue: 100, ...balance })];
    const h = computeInterimHealth([fy2024], cur); // no 2024 quarters stored
    const rev = h.comparisons.find((c) => c.metric === "revenue")!;
    expect(rev.latest).toBeNull();
    expect(rev.method).toBeNull();
    expect(h.flags.find((f) => f.metric === "revenue")).toBeUndefined();
  });

  it("falls back to four consecutive quarters when the annual report is more than a year old", () => {
    const qs = [
      q(2025, "Q1", "2025-03-31", { revenue: 100 }),
      q(2025, "Q2", "2025-06-30", { revenue: 100 }),
      q(2025, "Q3", "2025-09-30", { revenue: 100 }),
      q(2025, "Q4", "2025-12-31", { revenue: 100 }),
      q(2026, "Q1", "2026-03-31", { revenue: 100, ...balance }),
    ];
    const h = computeInterimHealth([fy2024], qs);
    const rev = h.comparisons.find((c) => c.metric === "revenue")!;
    expect(rev.method).toBe("FOUR_QUARTERS");
    expect(rev.latest).toBe(400);
    expect(h.flags.map((f) => f.code)).toContain("REVENUE_DECLINE");
  });

  it("reports when nothing was filed since the annual report, or no quarters exist", () => {
    expect(computeInterimHealth([fy2024], prior).status).toBe("ANNUAL_IS_LATEST");
    expect(computeInterimHealth([fy2024], []).status).toBe("NO_QUARTERS");
    expect(computeInterimHealth([], prior).status).toBe("NO_ANNUAL");
  });

  it("does not compare statements in different currencies", () => {
    const cur = [q(2025, "Q1", "2025-03-31", { revenue: 100 }, "EUR")];
    const h = computeInterimHealth([fy2024], [...prior, ...cur]);
    expect(h.status).toBe("CURRENCY_MISMATCH");
    expect(h.flags).toEqual([]);
  });

  it("percent change is not computed from a non-positive annual base", () => {
    const loss = annualYear(2024, { ...fy2024.values, netIncome: -50 });
    const cur = [q(2025, "Q1", "2025-03-31", { netIncome: -60, ...balance })];
    const h = computeInterimHealth([loss], [...prior, ...cur]);
    expect(h.comparisons.find((c) => c.metric === "netIncome")!.change).toBeNull();
  });

  it("leaves Graham's annual-statement analysis unchanged (interim data is never an input)", () => {
    const annual = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024].map((y) => annualYear(y, fy2024.values));
    const before = JSON.stringify(analyzeGraham({ annual, price: { value: 20, date: "2025-04-01", currency: "USD" } } as never));
    computeInterimHealth(annual, [...prior, q(2025, "Q1", "2025-03-31", { revenue: 1, netIncome: -500, ...balance })]);
    expect(JSON.stringify(analyzeGraham({ annual, price: { value: 20, date: "2025-04-01", currency: "USD" } } as never))).toBe(before);
  });
});
