import { describe, expect, it } from "vitest";
import { evaluateDefensive, evaluateEnterprising } from "@/lib/graham/rules";
import { healthyCompany, year } from "./helpers";

const rule = (r: ReturnType<typeof evaluateDefensive>, id: string) => r.rules.find((x) => x.id === id)!;

describe("Graham defensive criteria (Ch. 14, 1973)", () => {
  // BVPS = 120; EPS runs 2.00 → 7.00; avg EPS last 3y = (6.5+6.75+7)/3 = 6.75
  const annual = healthyCompany(2024, 21);

  it("passes all seven criteria for a company that meets them", () => {
    // price 60 → P/E 8.9, P/B 0.5
    const r = evaluateDefensive({ annual, price: { value: 60, date: "2025-03-01", currency: "USD" }, isUtility: false });
    expect(r.rules.map((x) => [x.id, x.status])).toEqual([
      ["defensive.size", "PASS"],
      ["defensive.financialCondition", "PASS"],
      ["defensive.earningsStability", "PASS"],
      ["defensive.dividendRecord", "PASS"],
      ["defensive.earningsGrowth", "PASS"],
      ["defensive.moderatePe", "PASS"],
      ["defensive.moderatePriceToAssets", "PASS"],
    ]);
    expect(r.outcome).toBe("MEETS_ALL");
  });

  it("uses 3-year average earnings for the P/E test", () => {
    const r = evaluateDefensive({ annual, price: { value: 105, date: "2025-03-01", currency: "USD" }, isUtility: false });
    const pe = rule(r, "defensive.moderatePe");
    expect(pe.measured.averageEps3y).toBeCloseTo(6.75, 10);
    expect(pe.measured.pe3y).toBeCloseTo(105 / 6.75, 10);
    expect(pe.status).toBe("FAIL"); // 15.6 > 15
  });

  it("accepts P/B above 1.5 when P/E × P/B ≤ 22.5", () => {
    // BVPS 10, avg EPS 6.75 → price 30: P/B 3 × P/E 4.44 = 13.3 PASS; price 40: 4 × 5.93 = 23.7 FAIL
    const lowBook = healthyCompany(2024, 21, () => ({ stockholdersEquity: 100_000_000 }));
    const pass = evaluateDefensive({ annual: lowBook, price: { value: 30, date: "2025-03-01", currency: "USD" }, isUtility: false });
    expect(rule(pass, "defensive.moderatePriceToAssets").status).toBe("PASS");
    expect(rule(pass, "defensive.moderatePriceToAssets").reason).toBe("comparedProduct");
    const fail = evaluateDefensive({ annual: lowBook, price: { value: 40, date: "2025-03-01", currency: "USD" }, isUtility: false });
    expect(rule(fail, "defensive.moderatePriceToAssets").status).toBe("FAIL");
  });

  it("fails financial condition when current ratio < 2 or LTD > working capital", () => {
    const weakCr = healthyCompany(2024, 12, () => ({ currentLiabilities: 500_000_000 }));
    expect(rule(evaluateDefensive({ annual: weakCr, price: null, isUtility: false }), "defensive.financialCondition").reason).toBe("currentRatioTooLow");
    const heavyDebt = healthyCompany(2024, 12, () => ({ longTermDebt: 700_000_000 }));
    expect(rule(evaluateDefensive({ annual: heavyDebt, price: null, isUtility: false }), "defensive.financialCondition").reason).toBe(
      "debtExceedsWorkingCapital",
    );
  });

  it("reports INSUFFICIENT_DATA (not FAIL) when history is too short and nothing disproves the rule", () => {
    const short = healthyCompany(2024, 6);
    const r = evaluateDefensive({ annual: short, price: { value: 30, date: "2025-03-01", currency: "USD" }, isUtility: false });
    expect(rule(r, "defensive.earningsStability").status).toBe("INSUFFICIENT_DATA");
    expect(rule(r, "defensive.dividendRecord").status).toBe("INSUFFICIENT_DATA");
    expect(rule(r, "defensive.earningsGrowth").status).toBe("INSUFFICIENT_DATA");
    expect(r.outcome).toBe("INCOMPLETE_DATA");
  });

  it("fails earnings stability as soon as one deficit year is known, even with short history", () => {
    const withLoss = healthyCompany(2024, 6, (fy) => (fy === 2021 ? { netIncome: -1, epsDiluted: -0.1 } : {}));
    const r = evaluateDefensive({ annual: withLoss, price: null, isUtility: false });
    expect(rule(r, "defensive.earningsStability").status).toBe("FAIL");
  });

  it("detects a dividend gap inside the 20-year window", () => {
    const gap = healthyCompany(2024, 21, (fy) => (fy === 2015 ? { dividendsPerShare: 0 } : {}));
    const r = evaluateDefensive({ annual: gap, price: null, isUtility: false });
    expect(rule(r, "defensive.dividendRecord").status).toBe("FAIL");
    expect(rule(r, "defensive.dividendRecord").measured.consecutiveDividendYears).toBe(9);
  });

  it("computes earnings growth from 3-year averages ten years apart", () => {
    const r = evaluateDefensive({ annual, price: null, isUtility: false });
    const g = rule(r, "defensive.earningsGrowth");
    // last year index 20 → EPS 7; end avg (6.5+6.75+7)/3=6.75; start years 2015..2017 → idx 11..13 → (4.75+5+5.25)/3=5
    expect(g.measured.endAverageEps).toBeCloseTo(6.75);
    expect(g.measured.startAverageEps).toBeCloseTo(5);
    expect(g.measured.growth).toBeCloseTo(0.35);
    expect(g.status).toBe("PASS");
  });

  it("uses the utility tests for public utilities", () => {
    const util = healthyCompany(2024, 12, () => ({ longTermDebt: 3_000_000_000, stockholdersEquity: 1_000_000_000 }));
    const r = evaluateDefensive({ annual: util, price: null, isUtility: true });
    expect(rule(r, "defensive.size").measured.totalAssetsUsd).toBe(2_000_000_000);
    expect(rule(r, "defensive.financialCondition").status).toBe("FAIL"); // D/E 3 > 2
  });

  it("does not mix price and statement currencies", () => {
    const r = evaluateDefensive({ annual, price: { value: 60, date: "2025-03-01", currency: "ILS" }, isUtility: false });
    expect(rule(r, "defensive.moderatePe").status).toBe("INSUFFICIENT_DATA");
    expect(rule(r, "defensive.moderatePe").reason).toBe("priceCurrencyMismatch");
  });

  it("needs an FX rate before applying the dollar size threshold to non-USD statements", () => {
    const ils = [year(2024, { revenue: 5_000_000_000 }, "ILS")];
    expect(rule(evaluateDefensive({ annual: ils, price: null, isUtility: false }), "defensive.size").reason).toBe("needsFxRate");
    expect(rule(evaluateDefensive({ annual: ils, price: null, isUtility: false, fxToUsd: 0.27 }), "defensive.size").status).toBe("PASS");
  });

  it("never treats missing long-term debt as zero unless all liabilities are current", () => {
    const noTag = healthyCompany(2024, 12, () => ({ longTermDebt: undefined }));
    expect(rule(evaluateDefensive({ annual: noTag, price: null, isUtility: false }), "defensive.financialCondition").status).toBe("INSUFFICIENT_DATA");
    const allCurrent = healthyCompany(2024, 12, () => ({ longTermDebt: undefined, totalLiabilities: 300_000_000 }));
    expect(rule(evaluateDefensive({ annual: allCurrent, price: null, isUtility: false }), "defensive.financialCondition").status).toBe("PASS");
  });
});

describe("Graham enterprising criteria (Ch. 15, 1973)", () => {
  it("evaluates the five criteria", () => {
    const annual = healthyCompany(2024, 8, () => ({ goodwill: 200_000_000 }));
    // TBVPS = (1.2B - 0.2B)/10M = 100 → price 110 < 120 ✓
    const r = evaluateEnterprising({ annual, price: { value: 110, date: "2025-03-01", currency: "USD" }, isUtility: false });
    expect(r.rules.map((x) => x.status)).toEqual(["PASS", "PASS", "PASS", "PASS", "PASS"]);
    const p = evaluateEnterprising({ annual, price: { value: 125, date: "2025-03-01", currency: "USD" }, isUtility: false });
    expect(p.rules.find((x) => x.id === "enterprising.priceToTangibleAssets")!.status).toBe("FAIL");
  });

  it("allows debt up to 110% of net current assets", () => {
    const annual = healthyCompany(2024, 8, () => ({ longTermDebt: 650_000_000 })); // NCA 600M → 108%
    const r = evaluateEnterprising({ annual, price: null, isUtility: false });
    expect(r.rules[0].status).toBe("PASS");
  });

  it("compares last year's EPS to the configured lookback year", () => {
    const annual = healthyCompany(2024, 8, (fy) => (fy === 2019 ? { epsDiluted: 50 } : {}));
    const r = evaluateEnterprising({ annual, price: null, isUtility: false });
    expect(r.rules.find((x) => x.id === "enterprising.earningsGrowth")!.status).toBe("FAIL");
    const r3 = evaluateEnterprising({ annual, price: null, isUtility: false }, { earningsGrowthLookbackYears: 3 });
    expect(r3.rules.find((x) => x.id === "enterprising.earningsGrowth")!.status).toBe("PASS");
  });
});
