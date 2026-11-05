import { describe, expect, it } from "vitest";
import { evaluateDefensive, evaluateEnterprising, ruleValue } from "@/lib/graham/rules";
import type { ScreenResult } from "@/lib/graham/types";
import { healthyCompany, year } from "./helpers";

const rule = (r: ScreenResult, id: string) => r.rules.find((x) => x.id === id)!;
const price = (value: number, currency = "USD") => ({ value, date: "2025-03-01", currency });

describe("Graham defensive criteria (Ch. 14, 1973)", () => {
  // BVPS = 120; EPS runs 2.00 → 7.00; avg EPS last 3y = (6.5+6.75+7)/3 = 6.75
  const annual = healthyCompany(2024, 21);

  it("passes all seven criteria for a company that meets them", () => {
    // price 60 → P/E 8.9, P/B 0.5
    const r = evaluateDefensive({ annual, price: price(60), isUtility: false });
    expect(r.rules.filter((x) => x.counted).map((x) => [x.id, x.status])).toEqual([
      ["D1", "PASS"],
      ["D2", "PASS"],
      ["D3", "PASS"],
      ["D4", "PASS"],
      ["D5", "PASS"],
      ["D6", "PASS"],
      ["D7", "PASS"],
    ]);
    expect(r.outcome).toBe("MEETS_ALL");
    expect(r.ruleSet).toBe("FULL");
  });

  it("uses 3-year average earnings for the P/E test", () => {
    const r = evaluateDefensive({ annual, price: price(105), isUtility: false });
    const pe = rule(r, "D6");
    expect(ruleValue(pe, "averageEps3y")).toBeCloseTo(6.75, 10);
    expect(ruleValue(pe, "pe3y")).toBeCloseTo(105 / 6.75, 10);
    expect(pe.status).toBe("FAIL"); // 15.6 > 15
  });

  it("accepts P/B above 1.5 when P/E × P/B ≤ 22.5", () => {
    // BVPS 10, avg EPS 6.75 → price 30: P/B 3 × P/E 4.44 = 13.3 PASS; price 40: 4 × 5.93 = 23.7 FAIL
    const lowBook = healthyCompany(2024, 21, () => ({ stockholdersEquity: 100_000_000 }));
    const pass = evaluateDefensive({ annual: lowBook, price: price(30), isUtility: false });
    expect(rule(pass, "D7").status).toBe("PASS");
    expect(rule(pass, "D7").reason).toBe("passedByProduct");
    const fail = evaluateDefensive({ annual: lowBook, price: price(40), isUtility: false });
    expect(rule(fail, "D7").status).toBe("FAIL");
  });

  it("fails financial condition when current ratio < 2 or LTD > working capital", () => {
    const weakCr = healthyCompany(2024, 12, () => ({ currentLiabilities: 500_000_000 }));
    expect(rule(evaluateDefensive({ annual: weakCr, price: null, isUtility: false }), "D2").reason).toBe("currentRatioTooLow");
    const heavyDebt = healthyCompany(2024, 12, () => ({ longTermDebt: 700_000_000 }));
    expect(rule(evaluateDefensive({ annual: heavyDebt, price: null, isUtility: false }), "D2").reason).toBe("debtExceedsWorkingCapital");
  });

  it("reports INSUFFICIENT_DATA (not FAIL) when history is too short and nothing disproves the rule", () => {
    const short = healthyCompany(2024, 6);
    const r = evaluateDefensive({ annual: short, price: price(30), isUtility: false });
    expect(rule(r, "D3").status).toBe("INSUFFICIENT_DATA");
    expect(rule(r, "D4").status).toBe("INSUFFICIENT_DATA");
    expect(rule(r, "D5").status).toBe("INSUFFICIENT_DATA");
    expect(r.outcome).toBe("INCOMPLETE_DATA");
  });

  it("fails earnings stability as soon as one deficit year is known, even with short history", () => {
    const withLoss = healthyCompany(2024, 6, (fy) => (fy === 2021 ? { netIncome: -1, epsDiluted: -0.1 } : {}));
    const r = evaluateDefensive({ annual: withLoss, price: null, isUtility: false });
    expect(rule(r, "D3").status).toBe("FAIL");
    expect(rule(r, "D3").reasonParams?.deficitYears).toBe("2021");
  });

  it("detects a dividend gap inside the 20-year window", () => {
    const gap = healthyCompany(2024, 21, (fy) => (fy === 2015 ? { dividendsPerShare: 0 } : {}));
    const r = evaluateDefensive({ annual: gap, price: null, isUtility: false });
    expect(rule(r, "D4").status).toBe("FAIL");
    expect(ruleValue(rule(r, "D4"), "consecutiveDividendYears")).toBe(9);
  });

  it("computes earnings growth from 3-year averages ten years apart", () => {
    const r = evaluateDefensive({ annual, price: null, isUtility: false });
    const g = rule(r, "D5");
    // end avg (6.5+6.75+7)/3=6.75; start years 2015..2017 → (4.75+5+5.25)/3=5
    expect(ruleValue(g, "endAverageEps")).toBeCloseTo(6.75);
    expect(ruleValue(g, "startAverageEps")).toBeCloseTo(5);
    expect(ruleValue(g, "growth")).toBeCloseTo(0.35);
    expect(g.status).toBe("PASS");
  });

  it("uses the utility tests for public utilities", () => {
    const util = healthyCompany(2024, 12, () => ({ longTermDebt: 3_000_000_000, stockholdersEquity: 1_000_000_000 }));
    const r = evaluateDefensive({ annual: util, price: null, isUtility: true });
    expect(rule(r, "D1U").checks[0].actual).toBe(2_000_000_000);
    expect(rule(r, "D2U").status).toBe("FAIL"); // D/E 3 > 2
    expect(r.rules.some((x) => x.id === "D1" || x.id === "D2")).toBe(false);
  });

  it("does not mix price and statement currencies", () => {
    const r = evaluateDefensive({ annual, price: price(60, "ILS"), isUtility: false });
    expect(rule(r, "D6").status).toBe("INSUFFICIENT_DATA");
    expect(rule(r, "D6").reason).toBe("priceCurrencyMismatch");
  });

  it("needs an FX rate before applying the dollar size threshold to non-USD statements", () => {
    const ils = [year(2024, { revenue: 5_000_000_000 }, "ILS")];
    expect(rule(evaluateDefensive({ annual: ils, price: null, isUtility: false }), "D1").reason).toBe("needsFxRate");
    expect(rule(evaluateDefensive({ annual: ils, price: null, isUtility: false, fxToUsd: 0.27 }), "D1").status).toBe("PASS");
  });

  it("never treats missing long-term debt as zero unless all liabilities are current", () => {
    const noTag = healthyCompany(2024, 12, () => ({ longTermDebt: undefined }));
    expect(rule(evaluateDefensive({ annual: noTag, price: null, isUtility: false }), "D2").status).toBe("INSUFFICIENT_DATA");
    const allCurrent = healthyCompany(2024, 12, () => ({ longTermDebt: undefined, totalLiabilities: 300_000_000 }));
    const d2 = rule(evaluateDefensive({ annual: allCurrent, price: null, isUtility: false }), "D2");
    expect(d2.status).toBe("PASS");
    expect(d2.assumptions).toContain("AI-LTD");
  });
});

describe("Graham enterprising criteria (Ch. 15, 1973)", () => {
  // EPS 2.00 … 3.75; avg 3y (FY2022–24) = 3.5 → E6 limit 10.8 × 3.5 = 37.8; TBVPS = (1.2B − 0.2B)/10M = 100
  const annual = healthyCompany(2024, 8, () => ({ goodwill: 200_000_000, debtCurrent: 50_000_000 }));

  it("evaluates the seven criteria", () => {
    const r = evaluateEnterprising({ annual, price: price(30), isUtility: false });
    expect(r.rules.map((x) => [x.id, x.status])).toEqual([
      ["E1", "PASS"],
      ["E2", "PASS"],
      ["E3", "PASS"],
      ["E4", "PASS"],
      ["E5", "PASS"],
      ["E6", "PASS"],
      ["E7", "PASS"],
    ]);
    expect(r.unverifiedCounted).toBe(1); // E6
    const p = evaluateEnterprising({ annual, price: price(125), isUtility: false });
    expect(p.rules.find((x) => x.id === "E7")!.status).toBe("FAIL");
    expect(p.rules.find((x) => x.id === "E6")!.status).toBe("FAIL");
  });

  it("allows total debt up to 110% of net current assets", () => {
    const ok = healthyCompany(2024, 8, () => ({ longTermDebt: 600_000_000, debtCurrent: 50_000_000 })); // NCA 600M → 108%
    expect(evaluateEnterprising({ annual: ok, price: null, isUtility: false }).rules[1].status).toBe("PASS");
    const over = healthyCompany(2024, 8, () => ({ longTermDebt: 600_000_000, debtCurrent: 70_000_000 })); // 111.7%
    expect(evaluateEnterprising({ annual: over, price: null, isUtility: false }).rules[1].status).toBe("FAIL");
  });

  it("compares last year's EPS to the configured lookback year", () => {
    const a = healthyCompany(2024, 8, (fy) => (fy === 2019 ? { epsDiluted: 50 } : {}));
    const r = evaluateEnterprising({ annual: a, price: null, isUtility: false });
    expect(r.rules.find((x) => x.id === "E5")!.status).toBe("FAIL");
    const r3 = evaluateEnterprising({ annual: a, price: null, isUtility: false }, { earningsGrowthLookbackYears: 3 });
    expect(r3.rules.find((x) => x.id === "E5")!.status).toBe("PASS");
  });
});
