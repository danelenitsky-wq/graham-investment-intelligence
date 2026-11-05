import { describe, expect, it } from "vitest";
import { analyzeGraham } from "@/lib/graham";
import { classifyBySic, classifyIssuer, type IndustryClassification } from "@/lib/graham/classification";
import { dividendEvidence, fiscalYearOfDate, fullyCoveredFiscalYears, screenDistributions } from "@/lib/graham/dividends";
import { CPI_DEFAULT, REGISTRY_CATEGORIES, RULES_REGISTRY } from "@/lib/graham/registry";
import { evaluateDefensive, evaluateEnterprising, ruleValue } from "@/lib/graham/rules";
import type { GrahamInputs, RuleResult, ScreenResult } from "@/lib/graham/types";
import { issuerProfile } from "@/lib/providers/sec-edgar/parse";
import { healthyCompany, year } from "./helpers";

const rule = (r: ScreenResult, id: string): RuleResult => {
  const x = r.rules.find((y) => y.id === id);
  if (!x) throw new Error(`rule ${id} missing`);
  return x;
};
const price = (value: number, date = "2025-03-03") => ({ value, date, currency: "USD" });
const cls = (industryClass: IndustryClassification["industryClass"]): IndustryClassification => ({ industryClass, basis: "SIC", sicCode: null });

/** Daily closes on business days between two dates (synthetic test data, not market data). */
function closes(from: string, to: string, close = 100) {
  const out: { date: string; close: number }[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), close });
  }
  return out;
}

// ───────────────────────────────────── formulas ─────────────────────────────────────

describe("formulas", () => {
  const annual = healthyCompany(2024, 21);
  const d = evaluateDefensive({ annual, price: price(60) });

  it("D1: latest revenue vs $100M nominal", () => {
    expect(rule(d, "D1").checks[0]).toMatchObject({ actual: 1_000_000_000, op: ">=", threshold: 100_000_000, passed: true });
    const small = evaluateDefensive({ annual: healthyCompany(2024, 12, () => ({ revenue: 99_999_999 })), price: null });
    expect(rule(small, "D1").status).toBe("FAIL");
  });

  it("D1-M: sourced CPI-U adjustment (1973 = 44.4, 2025 = 321.9), advisory only", () => {
    const m = rule(d, "D1-M");
    expect(m.counted).toBe(false);
    expect(m.category).toBe("MODERN_ADAPTATION");
    expect(ruleValue(m, "inflationFactor")).toBeCloseTo(321.9 / 44.4, 10);
    expect(m.checks[0].threshold).toBeCloseTo(100_000_000 * (321.9 / 44.4), 2);
    expect(m.sources[0]).toMatchObject({ kind: "REFERENCE", url: CPI_DEFAULT.sourceUrl });
    // Fails in today's dollars while D1 passes: the qualification is unchanged.
    const mid = evaluateDefensive({ annual: healthyCompany(2024, 21, () => ({ revenue: 500_000_000 })), price: price(60) });
    expect(rule(mid, "D1").status).toBe("PASS");
    expect(rule(mid, "D1-M").status).toBe("FAIL");
    expect(mid.outcome).toBe("MEETS_ALL");
  });

  it("D2: current ratio = CA / CL and NWC = CA − CL", () => {
    const d2 = rule(d, "D2");
    expect(ruleValue(d2, "currentRatio")).toBeCloseTo(3);
    expect(ruleValue(d2, "netWorkingCapital")).toBe(600_000_000);
    expect(d2.checks[1]).toMatchObject({ key: "longTermDebt", actual: 400_000_000, threshold: 600_000_000, passed: true });
  });

  it("D3/E3: positive earnings in each year of the window", () => {
    expect(rule(d, "D3").checks[0]).toMatchObject({ actual: 10, threshold: 10, passed: true });
    expect(rule(d, "D3").period).toBe("FY2015–FY2024");
  });

  it("D6: price / 3-year average EPS; D7: P/B and the 22.5 product", () => {
    expect(ruleValue(rule(d, "D6"), "pe3y")).toBeCloseTo(60 / 6.75);
    const d7 = rule(d, "D7");
    expect(ruleValue(d7, "bookValuePerShare")).toBe(120);
    expect(ruleValue(d7, "priceToBook")).toBeCloseTo(0.5);
    expect(ruleValue(d7, "peTimesPb")).toBeCloseTo((60 / 6.75) * 0.5);
  });

  it("E2: total debt = LTD + current debt vs 110% of net current assets", () => {
    const e = evaluateEnterprising({ annual: healthyCompany(2024, 8, () => ({ debtCurrent: 100_000_000 })), price: null });
    const e2 = rule(e, "E2");
    expect(ruleValue(e2, "totalDebt")).toBe(500_000_000);
    expect(e2.checks[0].threshold).toBeCloseTo(660_000_000);
    expect(ruleValue(e2, "debtToNetCurrentAssets")).toBeCloseTo(500 / 600);
  });

  it("E2: current maturities + short-term borrowings unless DebtCurrent (which already includes them) is the tag", () => {
    const a = healthyCompany(2024, 8, () => ({ debtCurrent: 100_000_000, shortTermBorrowings: 50_000_000 }));
    const asCurrentMaturities = evaluateEnterprising({ annual: a, price: null, provenance: [{ fiscalYear: 2024, periodEnd: "2024-12-31", sourceName: "SEC", form: "10-K", accessionNumber: null, filingUrl: null, concepts: { debtCurrent: "us-gaap:LongTermDebtCurrent" } }] });
    expect(ruleValue(rule(asCurrentMaturities, "E2"), "totalDebt")).toBe(550_000_000);
    const asDebtCurrent = evaluateEnterprising({ annual: a, price: null, provenance: [{ fiscalYear: 2024, periodEnd: "2024-12-31", sourceName: "SEC", form: "10-K", accessionNumber: null, filingUrl: null, concepts: { debtCurrent: "us-gaap:DebtCurrent" } }] });
    expect(ruleValue(rule(asDebtCurrent, "E2"), "totalDebt")).toBe(500_000_000);
  });

  it("E6 (UNVERIFIED): price ≤ 1.2 × 9 × average EPS", () => {
    const e = evaluateEnterprising({ annual: healthyCompany(2024, 8), price: price(37.8) });
    const e6 = rule(e, "E6");
    expect(e6.verification).toBe("UNVERIFIED");
    expect(e6.counted).toBe(true);
    expect(ruleValue(e6, "earningsValue9x")).toBeCloseTo(31.5);
    expect(e6.checks[0].threshold).toBeCloseTo(37.8);
    expect(e6.status).toBe("PASS");
    expect(rule(evaluateEnterprising({ annual: healthyCompany(2024, 8), price: price(37.81) }), "E6").status).toBe("FAIL");
  });

  it("E7: price strictly below 120% of net tangible assets per share", () => {
    const a = healthyCompany(2024, 8, () => ({ goodwill: 150_000_000, intangibleAssets: 50_000_000 }));
    expect(ruleValue(rule(evaluateEnterprising({ annual: a, price: price(119.99) }), "E7"), "tangibleBookValuePerShare")).toBe(100);
    expect(rule(evaluateEnterprising({ annual: a, price: price(119.99) }), "E7").status).toBe("PASS");
    expect(rule(evaluateEnterprising({ annual: a, price: price(120) }), "E7").status).toBe("FAIL"); // "less than"
  });

  it("every rule returns id, reference, inputs, formula, checks, threshold, status, explanation, source and period", () => {
    const g = analyzeGraham({ annual, price: price(60) });
    for (const r of [...g.defensive.rules, ...g.enterprising.rules, ...g.netNet.screen.rules]) {
      expect(r.id).toBeTruthy();
      expect(r.citation?.chapter).toBeGreaterThan(0);
      expect(r.formula.length).toBeGreaterThan(3);
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.checks.length).toBeGreaterThan(0);
      for (const c of r.checks) expect(c.threshold).not.toBeUndefined();
      expect(["PASS", "FAIL", "INSUFFICIENT_DATA", "NOT_APPLICABLE"]).toContain(r.status);
      expect(r.reason).toBeTruthy();
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.period).toBeTruthy();
    }
  });
});

// ──────────────────────────────────── negative EPS ────────────────────────────────────

describe("negative EPS", () => {
  const losses = healthyCompany(2024, 21, (fy) => (fy >= 2022 ? { epsDiluted: -1, netIncome: -10_000_000 } : {}));

  it("fails D3 and E3, and D6/E6 because no price meets a multiple of negative earnings", () => {
    const d = evaluateDefensive({ annual: losses, price: price(10) });
    expect(rule(d, "D3").status).toBe("FAIL");
    expect(rule(d, "D6").status).toBe("FAIL");
    expect(rule(d, "D6").reason).toBe("nonPositiveEarnings");
    expect(ruleValue(rule(d, "D6"), "pe3y")).toBeNull(); // never a negative P/E
    const e = evaluateEnterprising({ annual: losses, price: price(10) });
    expect(rule(e, "E3").status).toBe("FAIL");
    expect(rule(e, "E6").status).toBe("FAIL");
  });

  it("D7 product side fails with negative earnings, but P/B ≤ 1.5 alone still passes D7", () => {
    const d = evaluateDefensive({ annual: losses, price: price(10) }); // P/B 10/120
    expect(rule(d, "D7").status).toBe("PASS");
    expect(rule(d, "D7").checks[1].passed).toBe(false);
    const lowBook = healthyCompany(2024, 21, (fy) => ({ stockholdersEquity: 50_000_000, ...(fy >= 2022 ? { epsDiluted: -1 } : {}) }));
    expect(rule(evaluateDefensive({ annual: lowBook, price: price(10) }), "D7").status).toBe("FAIL");
  });

  it("D5 is undefined from a non-positive base, and fails when earnings did not rise", () => {
    const negBaseUp = healthyCompany(2024, 21, (fy) => (fy >= 2015 && fy <= 2017 ? { epsDiluted: -0.5 } : {}));
    const up = rule(evaluateDefensive({ annual: negBaseUp, price: null }), "D5");
    expect(up.status).toBe("INSUFFICIENT_DATA");
    expect(up.reason).toBe("growthUndefinedNonPositiveBase");
    const negBaseDown = healthyCompany(2024, 21, (fy) => (fy >= 2015 && fy <= 2017 ? { epsDiluted: -0.5 } : fy >= 2022 ? { epsDiluted: -2 } : {}));
    expect(rule(evaluateDefensive({ annual: negBaseDown, price: null }), "D5").status).toBe("FAIL");
  });

  it("E5 compares signed EPS", () => {
    const a = healthyCompany(2024, 8, (fy) => (fy === 2019 ? { epsDiluted: -3 } : fy === 2024 ? { epsDiluted: -1 } : {}));
    expect(rule(evaluateEnterprising({ annual: a, price: null }), "E5").status).toBe("PASS"); // −1 > −3
  });
});

// ─────────────────────────────────── zero denominators ───────────────────────────────────

describe("zero denominators", () => {
  it("current liabilities of zero make the current ratio undefined, not infinite", () => {
    const a = healthyCompany(2024, 12, () => ({ currentLiabilities: 0 }));
    const d2 = rule(evaluateDefensive({ annual: a, price: null }), "D2");
    expect(ruleValue(d2, "currentRatio")).toBeNull();
    expect(d2.status).toBe("INSUFFICIENT_DATA");
    expect(d2.reason).toBe("zeroDenominator");
    expect(rule(evaluateEnterprising({ annual: a, price: null }), "E1").reason).toBe("zeroDenominator");
  });

  it("zero average EPS fails the multiple tests without dividing by zero", () => {
    const a = healthyCompany(2024, 12, (fy) => (fy >= 2022 ? { epsDiluted: 0 } : {}));
    const d6 = rule(evaluateDefensive({ annual: a, price: price(10) }), "D6");
    expect(d6.status).toBe("FAIL");
    expect(ruleValue(d6, "pe3y")).toBeNull();
  });

  it("zero shares outstanding leaves per-share values unknown", () => {
    const a = healthyCompany(2024, 12, () => ({ sharesOutstanding: 0, dilutedShares: 0 }));
    const g = analyzeGraham({ annual: a, price: price(10) });
    expect(ruleValue(rule(g.defensive, "D7"), "bookValuePerShare")).toBeNull();
    expect(rule(g.defensive, "D7").status).toBe("INSUFFICIENT_DATA");
    expect(g.netNet.ncavPerShare).toBeNull();
    expect(g.netNet.screen.rules[0].status).toBe("INSUFFICIENT_DATA");
  });

  it("zero book value fails D7 and zero tangible assets fail E7", () => {
    const a = healthyCompany(2024, 12, () => ({ stockholdersEquity: 0 }));
    expect(rule(evaluateDefensive({ annual: a, price: price(10) }), "D7").reason).toBe("nonPositiveBookValue");
    expect(rule(evaluateEnterprising({ annual: a, price: price(10) }), "E7").reason).toBe("nonPositiveTangibleBook");
  });
});

// ─────────────────────────────── missing historical years ───────────────────────────────

describe("missing historical years", () => {
  const withHole = healthyCompany(2024, 21).filter((a) => a.fiscalYear !== 2018);

  it("a missing year is INSUFFICIENT_DATA, never a zero", () => {
    const d = evaluateDefensive({ annual: withHole, price: price(60) });
    expect(rule(d, "D3").status).toBe("INSUFFICIENT_DATA");
    expect(rule(d, "D3").reasonParams?.missingYears).toBe("2018");
    expect(rule(d, "D3").inputs.find((i) => i.fiscalYear === 2018)).toMatchObject({ value: null, note: "missing" });
  });

  it("averages need all three years", () => {
    const hole = healthyCompany(2024, 21).filter((a) => a.fiscalYear !== 2023);
    const d = evaluateDefensive({ annual: hole, price: price(60) });
    expect(ruleValue(rule(d, "D6"), "averageEps3y")).toBeNull();
    expect(rule(d, "D6").status).toBe("INSUFFICIENT_DATA");
    expect(rule(d, "D5").status).toBe("INSUFFICIENT_DATA");
  });

  it("a known loss still fails even when other years are missing", () => {
    const a = withHole.map((x) => (x.fiscalYear === 2020 ? { ...x, values: { ...x.values, netIncome: -1 } } : x));
    expect(rule(evaluateDefensive({ annual: a, price: null }), "D3").status).toBe("FAIL");
  });

  it("missing current debt: long-term debt alone can only prove a failure", () => {
    const unknown = rule(evaluateEnterprising({ annual: healthyCompany(2024, 8), price: null }), "E2");
    expect(unknown.status).toBe("INSUFFICIENT_DATA");
    expect(unknown.reason).toBe("missingCurrentDebt");
    const proven = rule(evaluateEnterprising({ annual: healthyCompany(2024, 8, () => ({ longTermDebt: 700_000_000 })), price: null }), "E2");
    expect(proven.status).toBe("FAIL");
    expect(proven.inputs.find((i) => i.key === "totalDebt")?.note).toBe("lowerBound");
  });

  it("intangibles not tagged on an incomplete balance sheet stay unknown", () => {
    const incomplete = healthyCompany(2024, 8, () => ({ totalLiabilities: undefined }));
    const e7 = rule(evaluateEnterprising({ annual: incomplete, price: price(50) }), "E7");
    expect(e7.status).toBe("INSUFFICIENT_DATA");
    expect(e7.inputs.find((i) => i.key === "goodwill")).toMatchObject({ value: null, note: "missing" });
  });

  it("untagged lines on a complete balance sheet are flagged as inferred, not silently zero", () => {
    const e7 = rule(evaluateEnterprising({ annual: healthyCompany(2024, 8), price: price(50) }), "E7");
    expect(e7.inputs.find((i) => i.key === "goodwill")).toMatchObject({ value: 0, note: "inferredAbsent" });
    expect(e7.assumptions).toContain("AI-ABSENT-LINE");
  });
});

// ─────────────────────────────── P/B compensation rule ───────────────────────────────

describe("P/B compensation rule (D7) and the separate P/E requirement (D6)", () => {
  // EPS 1 every year, BVPS chosen per test.
  const flat = (bvps: number) =>
    healthyCompany(2024, 21, () => ({ epsDiluted: 1, netIncome: 10_000_000, stockholdersEquity: bvps * 10_000_000 }));

  it("P/E 9 × P/B 2.5 = 22.5 passes on the boundary (Graham's own example)", () => {
    const d = evaluateDefensive({ annual: flat(3.6), price: price(9) });
    expect(ruleValue(rule(d, "D7"), "peTimesPb")).toBeCloseTo(22.5, 10);
    expect(rule(d, "D7").status).toBe("PASS");
    expect(rule(d, "D7").reason).toBe("passedByProduct");
  });

  it("P/B above 1.5 with a product above 22.5 fails", () => {
    expect(rule(evaluateDefensive({ annual: flat(3.6), price: price(9.1) }), "D7").status).toBe("FAIL");
  });

  it("a low P/B cannot rescue a P/E above 15: D6 fails on its own", () => {
    const d = evaluateDefensive({ annual: flat(20), price: price(16) }); // P/E 16, P/B 0.8
    expect(rule(d, "D7").status).toBe("PASS");
    expect(rule(d, "D6").status).toBe("FAIL");
    expect(d.outcome).toBe("FAILS_ONE_OR_MORE");
  });

  it("D7 is INSUFFICIENT_DATA when P/B > 1.5 and the P/E side is unknown", () => {
    const a = flat(2).filter((x) => x.fiscalYear !== 2023);
    expect(rule(evaluateDefensive({ annual: a, price: price(5) }), "D7").status).toBe("INSUFFICIENT_DATA");
  });
});

// ─────────────────────────────────────── Net-Net ───────────────────────────────────────

describe("Net-Net", () => {
  // CA 900M, TL 300M → NCAV 600M; 10M shares → 60/share; threshold 40.
  const netnet = healthyCompany(2024, 8, () => ({ totalLiabilities: 300_000_000, longTermDebt: 0, cashAndEquivalents: 400_000_000, operatingCashFlow: 50_000_000, capitalExpenditures: 20_000_000 }));

  it("computes NCAV, NCAV per share and the two-thirds threshold", () => {
    const g = analyzeGraham({ annual: netnet, price: price(40) });
    expect(g.netNet.ncav).toBe(600_000_000);
    expect(g.netNet.ncavPerShare).toBe(60);
    expect(g.netNet.purchaseThreshold).toBeCloseTo(40);
    const nn = g.netNet.screen.rules[0];
    expect(nn.id).toBe("NN1");
    expect(nn.status).toBe("PASS");
    expect(nn.verification).toBe("UNVERIFIED");
    expect(ruleValue(nn, "priceToNcav")).toBeCloseTo(40 / 60);
  });

  it("fails above the threshold and when NCAV is not positive", () => {
    expect(analyzeGraham({ annual: netnet, price: price(40.01) }).netNet.screen.rules[0].status).toBe("FAIL");
    const negative = healthyCompany(2024, 8, () => ({ totalLiabilities: 1_000_000_000 }));
    const nn = analyzeGraham({ annual: negative, price: price(1) }).netNet.screen.rules[0];
    expect(nn.status).toBe("FAIL");
    expect(nn.reason).toBe("nonPositiveNcav");
  });

  it("derives total liabilities from L&E − equity when no total-liabilities line is tagged", () => {
    const a = healthyCompany(2024, 8, () => ({ totalLiabilities: undefined, liabilitiesAndEquity: 1_500_000_000, totalEquityInclNci: 1_200_000_000 }));
    const g = analyzeGraham({ annual: a, price: price(1) });
    expect(g.netNet.ncav).toBe(900_000_000 - 300_000_000);
    const tl = g.netNet.screen.rules[0].inputs.find((i) => i.key === "totalLiabilities");
    expect(tl).toMatchObject({ value: 300_000_000, note: "derived" });
    expect(g.netNet.screen.rules[0].assumptions).toContain("X-TL");
  });

  it("missing total liabilities are not treated as zero", () => {
    const a = healthyCompany(2024, 8, () => ({ totalLiabilities: undefined }));
    const g = analyzeGraham({ annual: a, price: price(1) });
    expect(g.netNet.ncav).toBeNull();
    expect(g.netNet.screen.rules[0].reason).toBe("missingTotalLiabilities");
  });

  it("shows the preferred-adjusted NCAV when preferred stock is reported", () => {
    const a = healthyCompany(2024, 8, () => ({ totalLiabilities: 300_000_000, preferredStock: 100_000_000 }));
    const nn = analyzeGraham({ annual: a, price: price(1) }).netNet.screen.rules[0];
    expect(ruleValue(nn, "ncavAfterPreferred")).toBe(500_000_000);
  });

  it("reports the five risk indicators without changing the rule status", () => {
    const burning = healthyCompany(2024, 8, (fy) => ({
      totalLiabilities: 300_000_000,
      operatingIncome: fy >= 2022 ? -5_000_000 : 10_000_000,
      operatingCashFlow: -60_000_000,
      capitalExpenditures: 20_000_000,
      cashAndEquivalents: 100_000_000,
      debtCurrent: 150_000_000,
      accountsReceivable: fy === 2024 ? 300_000_000 : 200_000_000,
      inventory: 100_000_000,
      sharesOutstanding: fy === 2024 ? 11_000_000 : 10_000_000,
    }));
    const g = analyzeGraham({ annual: burning, price: price(30) });
    const risk = Object.fromEntries(g.netNet.risks.map((r) => [r.id, r]));
    expect(Object.keys(risk).sort()).toEqual(["cashBurn", "debtMaturity", "dilution", "operatingLosses", "workingCapitalQuality"]);
    expect(risk.cashBurn.level).toBe("HIGH"); // runway 100 / 80 = 1.25 years
    expect(risk.cashBurn.values.find((v) => v.key === "runwayYears")?.value).toBeCloseTo(1.25);
    expect(risk.operatingLosses.level).toBe("HIGH"); // latest year a loss
    expect(risk.debtMaturity.level).toBe("HIGH"); // 150 > cash 100
    expect(risk.workingCapitalQuality.level).toBe("WATCH"); // receivables +50% vs flat sales
    expect(risk.dilution.level).toBe("HIGH"); // +10% in a year
    expect(g.netNet.screen.rules[0].status).toBe("PASS"); // 30 ≤ 40: risks are informational
  });

  it("risk indicators report missing data instead of assuming zero", () => {
    const g = analyzeGraham({ annual: [year(2024, { currentAssets: 100, totalLiabilities: 50, sharesOutstanding: 10 })], price: price(1) });
    for (const r of g.netNet.risks) expect(r.level).toBe("INSUFFICIENT_DATA");
  });
});

// ───────────────────────── enterprising pass, defensive fail ─────────────────────────

describe("companies passing enterprising but failing defensive", () => {
  it("a smaller, younger company with CR 1.8 and an 8-year dividend record", () => {
    const a = healthyCompany(2024, 8, () => ({
      revenue: 80_000_000, // below D1
      currentAssets: 540_000_000,
      currentLiabilities: 300_000_000, // CR 1.8: fails D2, passes E1
      longTermDebt: 200_000_000,
      debtCurrent: 20_000_000, // total 220M ≤ 1.1 × 240M
      goodwill: 0,
    }));
    const g = analyzeGraham({ annual: a, price: price(30) });
    expect(g.enterprising.outcome).toBe("MEETS_ALL");
    expect(g.defensive.outcome).toBe("FAILS_ONE_OR_MORE");
    expect(rule(g.defensive, "D1").status).toBe("FAIL");
    expect(rule(g.defensive, "D2").status).toBe("FAIL");
    expect(rule(g.defensive, "D4").status).toBe("INSUFFICIENT_DATA"); // only 8 years of data: not a failure
  });
});

// ───────────────────────────── financial-sector exclusions ─────────────────────────────

describe("financial-sector exclusions", () => {
  const annual = healthyCompany(2024, 21);
  const statuses = (s: ScreenResult) => Object.fromEntries(s.rules.map((r) => [r.id, r.status]));

  it("classifies by SEC SIC code", () => {
    expect(classifyBySic("6021")).toBe("BANK");
    expect(classifyBySic("6022")).toBe("BANK");
    expect(classifyBySic("6331")).toBe("INSURANCE");
    expect(classifyBySic("6798")).toBe("REIT");
    expect(classifyBySic("6211")).toBe("OTHER_FINANCIAL");
    expect(classifyBySic("4911")).toBe("UTILITY");
    expect(classifyBySic("4953")).toBe("INDUSTRIAL"); // refuse systems are not a Graham utility
    expect(classifyBySic("7372")).toBe("INDUSTRIAL");
    expect(classifyIssuer({ assetType: "ETF", sicCode: "7372" }).industryClass).toBe("ETF");
    expect(classifyIssuer({ latest: year(2024, { totalAssets: 1e9 }) })).toMatchObject({ industryClass: "OTHER_FINANCIAL", basis: "UNCLASSIFIED_BALANCE_SHEET" });
    expect(classifyIssuer({ latest: annual[annual.length - 1] })).toMatchObject({ industryClass: "INDUSTRIAL", basis: "DEFAULT" });
  });

  for (const c of ["BANK", "INSURANCE"] as const) {
    it(`${c}: no industrial size / working-capital / net-net tests; earnings, dividend and price tests apply`, () => {
      const g = analyzeGraham({ annual, price: price(60), classification: cls(c) });
      const d = statuses(g.defensive);
      expect(d).toMatchObject({ D1: "NOT_APPLICABLE", D2: "NOT_APPLICABLE", D3: "PASS", D4: "PASS", D5: "PASS", D6: "PASS", D7: "PASS" });
      expect(statuses(g.enterprising)).toMatchObject({ E1: "NOT_APPLICABLE", E2: "NOT_APPLICABLE", E7: "NOT_APPLICABLE", E3: "PASS" });
      expect(g.netNet.screen.outcome).toBe("NOT_APPLICABLE");
      expect(g.netNet.risks).toHaveLength(0);
      expect(g.defensive.ruleSet).toBe("SPECIALIZED");
      expect(g.defensive.outcome).toBe("MEETS_ALL");
      expect(rule(g.defensive, "D1").reason).toBe("notApplicableIssuerType");
    });
  }

  for (const c of ["REIT", "ETF", "OTHER_FINANCIAL"] as const) {
    it(`${c}: every Graham rule is NOT_APPLICABLE`, () => {
      const g = analyzeGraham({ annual, price: price(60), classification: cls(c) });
      for (const s of [g.defensive, g.enterprising, g.netNet.screen]) {
        expect(s.outcome).toBe("NOT_APPLICABLE");
        expect(s.ruleSet).toBe("NONE");
        for (const r of s.rules) expect(r.status).toBe("NOT_APPLICABLE");
      }
    });
  }

  it("UTILITY: Graham's utility size and debt tests; no industrial working-capital or net-net tests", () => {
    const g = analyzeGraham({ annual, price: price(60), classification: cls("UTILITY") });
    expect(statuses(g.defensive)).toMatchObject({ D1U: "PASS", D2U: "PASS", D3: "PASS" });
    expect(statuses(g.enterprising)).toMatchObject({ E1: "NOT_APPLICABLE", E2: "NOT_APPLICABLE", E3: "PASS" });
    expect(g.netNet.screen.outcome).toBe("NOT_APPLICABLE");
  });
});

// ─────────────────────────────────────── dividends ───────────────────────────────────────

describe("dividend record data handling", () => {
  it("excludes the GOOGL 2014 Class C distribution reported as a $567.97 cash dividend", () => {
    const c = [...closes("2014-03-20", "2014-04-01", 1135), ...closes("2014-04-02", "2014-04-10", 567)];
    const s = screenDistributions([{ exDate: "2014-04-02", amount: 567.97 }, { exDate: "2014-06-10", amount: 0.5 }], c);
    expect(s.excluded).toHaveLength(1);
    expect(s.excluded[0]).toMatchObject({ exDate: "2014-04-02", amount: 567.97, reason: "DISTRIBUTION_EXCEEDS_PRICE_SHARE" });
    expect(s.kept).toEqual([{ exDate: "2014-06-10", amount: 0.5 }]);
  });

  it("the excluded distribution does not count as a dividend year", () => {
    const annual = healthyCompany(2024, 21, () => ({ dividendsPerShare: undefined }));
    const g = analyzeGraham({
      annual,
      price: price(60, "2024-12-31"),
      dividends: [{ exDate: "2014-04-02", amount: 567.97 }],
      closes: closes("2014-03-01", "2014-04-30", 1135),
      priceHistoryRange: { first: "2004-01-02", last: "2024-12-31" },
    });
    expect(g.excludedDistributions).toHaveLength(1);
    expect(rule(g.defensive, "D4").status).toBe("FAIL"); // history covered, no real dividend
    expect(ruleValue(rule(g.defensive, "D4"), "excludedDistributions")).toBe(1);
  });

  it("returns INSUFFICIENT_DATA, not FAIL, when 20 years of dividend data are unavailable", () => {
    const annual = healthyCompany(2024, 21, () => ({ dividendsPerShare: undefined }));
    const dividends = Array.from({ length: 12 }, (_, i) => ({ exDate: `${2013 + i}-06-15`, amount: 1 }));
    const g = analyzeGraham({ annual, price: price(60, "2024-12-31"), dividends, priceHistoryRange: { first: "2013-01-02", last: "2024-12-31" } });
    const d4 = rule(g.defensive, "D4");
    expect(d4.status).toBe("INSUFFICIENT_DATA");
    expect(d4.reason).toBe("dividendHistoryTooShort");
    expect(ruleValue(d4, "consecutiveDividendYears")).toBe(12);
  });

  it("passes with 20 covered fiscal years of dividends", () => {
    const annual = healthyCompany(2024, 21, () => ({ dividendsPerShare: undefined }));
    const dividends = Array.from({ length: 21 }, (_, i) => ({ exDate: `${2004 + i}-06-15`, amount: 1 }));
    const g = analyzeGraham({ annual, price: price(60, "2024-12-31"), dividends, priceHistoryRange: { first: "2004-01-02", last: "2024-12-31" } });
    expect(rule(g.defensive, "D4").status).toBe("PASS");
  });

  it("attributes ex-dates to the issuer's fiscal year (June year end)", () => {
    expect(fiscalYearOfDate("2024-08-15", 6)).toBe(2025);
    expect(fiscalYearOfDate("2024-05-15", 6)).toBe(2024);
    expect(fiscalYearOfDate("2024-05-15", null)).toBe(2024);
    expect(fullyCoveredFiscalYears({ first: "2004-07-01", last: "2025-06-30" }, 6)).toEqual(Array.from({ length: 21 }, (_, i) => 2005 + i));
    expect(fullyCoveredFiscalYears({ first: "2006-01-03", last: "2025-12-31" }, 12)[0]).toBe(2006); // first trading day tolerance
  });

  it("an absent dividends-per-share tag is not evidence of no dividend; a reported zero is", () => {
    const ev = dividendEvidence({ annual: [], price: null }, [year(2023, { revenue: 1 }), year(2024, { dividendsPerShare: 0 })]);
    expect(ev.covered.has(2023)).toBe(false);
    expect(ev.covered.has(2024)).toBe(true);
  });

  it("E4 needs a cash dividend in the 12 months before the price date", () => {
    const annual = healthyCompany(2024, 8, () => ({ dividendsPerShare: undefined }));
    const base: GrahamInputs = { annual, price: price(30, "2025-03-03"), priceHistoryRange: { first: "2010-01-04", last: "2025-03-03" } };
    expect(rule(analyzeGraham({ ...base, dividends: [{ exDate: "2024-11-15", amount: 0.4 }] }).enterprising, "E4").status).toBe("PASS");
    expect(rule(analyzeGraham({ ...base, dividends: [{ exDate: "2023-11-15", amount: 0.4 }] }).enterprising, "E4").status).toBe("FAIL");
    const short = { ...base, priceHistoryRange: { first: "2024-12-01", last: "2025-03-03" }, dividends: [] };
    expect(rule(analyzeGraham(short).enterprising, "E4").status).toBe("INSUFFICIENT_DATA");
  });
});

// ─────────────────────────────────────── registry ───────────────────────────────────────

describe("rules registry", () => {
  it("covers every rule id and every interpretation the engine cites", () => {
    const g = analyzeGraham({ annual: healthyCompany(2024, 21), price: price(60) });
    const util = analyzeGraham({ annual: healthyCompany(2024, 21), price: price(60), classification: cls("UTILITY") });
    const bank = analyzeGraham({ annual: healthyCompany(2024, 21), price: price(60), classification: cls("BANK") });
    for (const a of [g, util, bank])
      for (const r of [...a.defensive.rules, ...a.enterprising.rules, ...a.netNet.screen.rules]) {
        expect(RULES_REGISTRY[r.id], r.id).toBeDefined();
        for (const x of r.assumptions) expect(RULES_REGISTRY[x], x).toBeDefined();
      }
  });

  it("distinguishes the four categories and flags unverified definitions", () => {
    const entries = Object.values(RULES_REGISTRY);
    for (const c of REGISTRY_CATEGORIES) expect(entries.some((e) => e.category === c)).toBe(true);
    expect(RULES_REGISTRY.E6.verification).toBe("UNVERIFIED");
    expect(RULES_REGISTRY.NN1.verification).toBe("UNVERIFIED");
    for (const e of entries) {
      if (e.category === "ORIGINAL_GRAHAM") expect(e.citation).not.toBeNull();
      if (e.verification === "VERIFIED_SECONDARY") expect(e.references?.length).toBeGreaterThan(0);
      if (e.category !== "ORIGINAL_GRAHAM") expect(e.verification).toBe("NOT_A_GRAHAM_RULE");
    }
  });

  it("is deterministic: the same inputs give the same output", () => {
    const inputs: GrahamInputs = { annual: healthyCompany(2024, 21), price: price(60) };
    expect(JSON.stringify(analyzeGraham(inputs))).toBe(JSON.stringify(analyzeGraham(inputs)));
  });
});

describe("SEC issuer profile", () => {
  it("reads the SIC code and fiscal-year-end month from submissions", () => {
    expect(issuerProfile({ cik: "789019", name: "MICROSOFT CORP", sic: "7372", sicDescription: "Services-Prepackaged Software", fiscalYearEnd: "0630" })).toEqual({
      sicCode: "7372",
      sicDescription: "Services-Prepackaged Software",
      fiscalYearEndMonth: 6,
    });
    expect(issuerProfile({ cik: "1", name: "X", sic: null, fiscalYearEnd: null })).toEqual({ sicCode: null, sicDescription: null, fiscalYearEndMonth: null });
  });
});
