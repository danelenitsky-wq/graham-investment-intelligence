import { describe, expect, it } from "vitest";
import { DECISION_CATEGORIES, FACTOR_IDS, evaluateDecision, renderFactorReason, renderStatement, type DecisionResult } from "@/lib/decision";
import { getDictionary } from "@/lib/i18n";
import { scenario, soundCompany } from "./decision-fixtures";

const factor = (d: DecisionResult, id: string) => d.factors.find((f) => f.id === id)!;
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

/** A loss in fiscal 2021: fails D3 (ten years) and E3 (five years). */
const withDeficit = () => soundCompany((fy, i) => (fy === 2021 ? { netIncome: -5_000_000, epsDiluted: -0.5, operatingIncome: -2_000_000 } : { epsDiluted: 2 + i * 0.4 }));

describe("decision engine — categories", () => {
  it("BUY CANDIDATE: strategy passes, price within the ceiling, margin of safety met, verified data", () => {
    const { decision: d } = scenario({ price: 60 });
    expect(d.category).toBe("BUY_CANDIDATE");
    expect(d.confidence).toBe("STANDARD");
    expect(d.caveats).toEqual([]);
    expect(codes(d.reasons)).toEqual(["buy.allCriteriaMet", "buy.withinCeiling"]);
    expect(d.methodology).toBe("APPLICATION_CLASSIFICATION");
    // Traceable: the reason cites every counted defensive rule.
    expect(d.reasons[0].evidence.map((e) => e.ref)).toEqual(expect.arrayContaining(["D1", "D2", "D3", "D4", "D5", "D6", "D7"]));
    expect(d.keyFigures.ceiling).toBeCloseTo(150, 6); // min(15 × avgEPS₃ 10, max(1.5 × BVPS 120, GN))
  });

  it("WAIT: price above the purchase threshold — failing the P/E limit is not AVOID", () => {
    const { decision: d } = scenario({ price: 200, intrinsicEnabled: false });
    expect(d.category).toBe("WAIT");
    expect(codes(d.reasons)).toEqual(["wait.priceAboveCeiling"]);
    expect(factor(d, "defensive")).toMatchObject({ status: "NEUTRAL", reason: "failsPriceCriteriaOnly" });
    expect(codes(d.caveats)).toContain("caveat.priceRulesNotQuality");
    const cond = d.conditions.find((c) => c.code === "cond.priceAtOrBelowCeiling")!;
    expect(cond.params.ceiling).toBeCloseTo(150, 6);
    expect(cond.params.change).toBeCloseTo(-25, 6);
  });

  it("WAIT even when the price is far above every Graham limit (never AVOID on valuation alone)", () => {
    const { decision: d } = scenario({ price: 1000 });
    expect(d.category).toBe("WAIT");
    expect(factor(d, "valuation").status).toBe("CRITICAL");
    expect(d.category).not.toBe("AVOID");
  });

  it("WAIT: within the ceiling but the required margin of safety is absent", () => {
    const { decision: d } = scenario({ price: 100 });
    expect(d.category).toBe("WAIT");
    expect(codes(d.reasons)).toEqual(["wait.marginOfSafetyAbsent"]);
    expect(factor(d, "marginOfSafety")).toMatchObject({ status: "UNFAVORABLE", reason: "belowTarget" });
    expect(d.conditions.map((c) => c.code)).toContain("cond.priceAtOrBelowMosTarget");
  });

  it("AVOID: an important (non-price) requirement of the strategy fails", () => {
    const { decision: d } = scenario({ price: 60, annual: withDeficit() });
    expect(d.category).toBe("AVOID");
    expect(d.reasons[0].code).toBe("avoid.failsStrategyRequirements");
    expect(String(d.reasons[0].params.rules)).toContain("D3");
    expect(factor(d, "earningsStability")).toMatchObject({ status: "UNFAVORABLE", reason: "recentDeficit" });
    expect(codes(d.conditions)).toContain("cond.rulePasses");
    expect(codes(d.caveats)).toContain("caveat.strategyRelative");
  });

  it("AVOID: unacceptable financial risk (debt due within a year exceeds cash)", () => {
    const annual = soundCompany((fy, i) => (fy === 2024 ? { debtMaturingNext12m: 250_000_000, cashAndEquivalents: 50_000_000, epsDiluted: 2 + i * 0.4 } : {}));
    const { decision: d } = scenario({ price: 60, annual });
    expect(d.category).toBe("AVOID");
    expect(["investmentRisks", "financialStrength"]).toContain(d.reasons[0].factor);
    expect(factor(d, "investmentRisks").status).toBe("CRITICAL");
  });

  it("AVOID under Net-Net when net current asset value is negative", () => {
    const { decision: d } = scenario({ price: 60, strategy: "NET_NET" });
    // currentAssets 900M − totalLiabilities 800M = NCAV 10/share > 0 → only the price fails: WAIT
    expect(d.category).toBe("WAIT");
    const neg = soundCompany(() => ({ totalLiabilities: 1_000_000_000 }));
    expect(scenario({ price: 60, strategy: "NET_NET", annual: neg }).decision.category).toBe("AVOID");
  });

  it("BUY CANDIDATE under Net-Net when the price is at most 2/3 of NCAV per share", () => {
    const rich = soundCompany(() => ({ currentAssets: 2_300_000_000 })); // NCAV = 1.5B → 150/share
    const { decision: d } = scenario({ price: 60, strategy: "NET_NET", annual: rich });
    expect(d.strategy).toBe("NET_NET");
    expect(d.keyFigures.ncavPerShare).toBeCloseTo(150, 6);
    expect(d.category).toBe("BUY_CANDIDATE");
    // NN1's two-thirds factor is UNVERIFIED: never a standard-confidence buy.
    expect(d.confidence).toBe("LOW");
    expect(codes(d.caveats)).toContain("caveat.unverifiedRuleWording");
  });
});

describe("decision engine — INSUFFICIENT VERIFIED DATA comes first", () => {
  it.each([
    [{ missing: ["price" as const] }, "data.requiredDataMissing"],
    [{ stale: ["financials" as const] }, "data.dataStale"],
    [{ conflicting: ["netIncome FY2024"] }, "data.dataConflict"],
    [{ notes: ["DEV_FIXTURE" as const] }, "data.devFixtureData"],
  ])("gate %j → %s", (gate, code) => {
    const { decision: d } = scenario({ price: 60, gate });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
    expect(d.reasons[0].code).toBe(code);
    expect(d.confidence).toBeNull();
    expect(d.conditions.length).toBeGreaterThan(0);
  });

  it("never reviews an owned position for sale on unreliable data", () => {
    const { decision: d } = scenario({ price: 1000, gate: { stale: ["price"] }, position: { weight: 0.9 } });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
    expect(d.reviewTriggers).toEqual([]);
    expect(codes(d.reasons)).toContain("owned.noReviewOnUnreliableData");
  });

  it("a historical (stale) quote is not a current price", () => {
    const { decision: d } = scenario({ price: 60, quoteStatus: "STALE" });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
    expect(factor(d, "dataQuality").reason).toBe("historicalPriceOnly");
  });

  it("validation errors in the statements block a classification", () => {
    const { decision: d } = scenario({ price: 60, issues: [{ severity: "ERROR", code: "BALANCE_SHEET_MISMATCH", fiscalYear: 2024 }] });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
    expect(d.reasons[0].code).toBe("data.validationErrors");
  });

  it("missing history for a non-price criterion is not a pass", () => {
    const short = soundCompany().slice(-6);
    const { decision: d } = scenario({ price: 60, annual: short });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
    expect(d.reasons[0].code).toBe("businessCriteriaIncomplete");
  });

  it("a strategy with no applicable rules for the issuer type makes no classification", () => {
    const { decision: d } = scenario({ price: 60, strategy: "NET_NET", industry: { sicCode: "6022" } });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
    expect(d.reasons[0].code).toBe("strategyNotApplicable");
  });

  it("no price at all → insufficient", () => {
    const { decision: d } = scenario({ price: null });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
  });
});

describe("decision engine — owned positions", () => {
  it("HOLD: thesis intact and no review trigger", () => {
    const { decision: d } = scenario({ price: 100, position: {} });
    expect(d.category).toBe("HOLD");
    expect(d.owned).toBe(true);
    expect(codes(d.reasons)).toEqual(["hold.thesisIntact"]);
    expect(d.reviewTriggers).toEqual([]);
    expect(codes(d.conditions)).toContain("cond.priceFallNotATrigger");
  });

  it("never recommends a sale because the price has fallen", () => {
    const deepLoss = scenario({ price: 30, position: { averageCost: 300 } }).decision; // −90% vs cost
    const bigGain = scenario({ price: 30, position: { averageCost: 3 } }).decision;
    expect(deepLoss.category).toBe("HOLD");
    expect(deepLoss.reviewTriggers).toEqual([]);
    // Cost basis does not enter the assessment at all.
    expect(deepLoss.category).toBe(bigGain.category);
    expect(deepLoss.factors).toEqual(bigGain.factors);
  });

  it("REVIEW FOR SALE: valuation becomes excessive (vs. intrinsic value when established)", () => {
    const { decision: d } = scenario({ price: 200, position: {} });
    expect(d.category).toBe("REVIEW_FOR_SALE");
    expect(codes(d.reviewTriggers)).toEqual(["trigger.valuationExcessive"]);
    expect(d.keyFigures.excessiveBasis).toBe("INTRINSIC");
    expect(d.keyFigures.excessiveAbove).toBeCloseTo(d.keyFigures.intrinsicValue! * 1.5, 6);
  });

  it("HOLD when the price is above the purchase ceiling but not excessive", () => {
    const { decision: d } = scenario({ price: 160, position: {}, intrinsicEnabled: false });
    expect(d.category).toBe("HOLD");
    expect(codes(d.reasons)).toContain("hold.priceAboveCeilingNotExcessive");
    expect(d.keyFigures.excessiveBasis).toBe("CEILING");
    expect(d.keyFigures.excessiveAbove).toBeCloseTo(225, 6);
  });

  it("REVIEW FOR SALE: portfolio concentration above the limit", () => {
    const { decision: d } = scenario({ price: 100, position: { weight: 0.35 } });
    expect(d.category).toBe("REVIEW_FOR_SALE");
    expect(codes(d.reviewTriggers)).toEqual(["trigger.concentration"]);
    expect(d.reviewTriggers[0].params).toMatchObject({ weight: 35, maxWeight: 20 });
  });

  it("REVIEW FOR SALE: the thesis is invalidated and fundamentals deteriorate", () => {
    const { decision: d } = scenario({ price: 60, annual: withDeficit(), position: {} });
    expect(d.category).toBe("REVIEW_FOR_SALE");
    expect(codes(d.reviewTriggers)).toEqual(expect.arrayContaining(["trigger.thesisInvalidated", "trigger.fundamentalsDeteriorated"]));
    expect(codes(d.reasons)).toEqual(["review.triggered"]);
  });

  it("assesses an owned stock under its recorded thesis strategy", () => {
    const { decision: d } = scenario({ price: 60, strategy: "DEFENSIVE", position: { thesisStrategy: "ENTERPRISING" } });
    expect(d.strategy).toBe("ENTERPRISING");
    expect(d.selectedStrategy).toBe("DEFENSIVE");
    expect(d.strategySource).toBe("POSITION_THESIS");
    expect(factor(d, "enterprising").inStrategy).toBe(true);
  });

  it("an unrecorded thesis falls back to the selected strategy, with a caveat", () => {
    const { decision: d } = scenario({ price: 100, position: { thesisStrategy: null } });
    expect(d.strategySource).toBe("SELECTED");
    expect(codes(d.caveats)).toContain("caveat.thesisNotRecorded");
    expect(d.confidence).toBe("LOW");
  });

  it("unknown position weight is flagged, not guessed", () => {
    const { decision: d } = scenario({ price: 100, position: { weight: null } });
    expect(factor(d, "ownership")).toMatchObject({ status: "UNKNOWN", reason: "weightUnknown" });
    expect(d.category).toBe("HOLD");
  });
});

describe("decision engine — confidence and honesty", () => {
  it("never fabricates intrinsic value: with the model off there is no value and no margin", () => {
    const { decision: d } = scenario({ price: 60, intrinsicEnabled: false });
    expect(d.keyFigures.intrinsicValue).toBeNull();
    expect(d.keyFigures.marginOfSafetyPercent).toBeNull();
    expect(factor(d, "marginOfSafety")).toMatchObject({ status: "UNKNOWN", reason: "intrinsicDisabled" });
    expect(d.category).toBe("BUY_CANDIDATE");
    expect(d.confidence).toBe("LOW");
    expect(codes(d.caveats)).toContain("caveat.noIntrinsicMargin");
  });

  it("can require an intrinsic-value margin of safety before BUY CANDIDATE", () => {
    const { decision: d } = scenario({ price: 60, intrinsicEnabled: false, settings: { requireIntrinsicMarginOfSafety: true } });
    expect(d.category).toBe("INSUFFICIENT_VERIFIED_DATA");
    expect(d.reasons[0].code).toBe("marginOfSafetyRequired");
  });

  it("no standard-confidence buy without cross-verified figures", () => {
    const { decision: d } = scenario({ price: 60, verification: null });
    expect(d.category).toBe("BUY_CANDIDATE");
    expect(d.confidence).toBe("LOW");
    expect(codes(d.caveats)).toContain("caveat.notCrossVerified");
  });

  it("an enterprising buy carries the E6 unverified-wording caveat", () => {
    const { decision: d } = scenario({ price: 60, strategy: "ENTERPRISING" });
    expect(d.category).toBe("BUY_CANDIDATE");
    expect(d.confidence).toBe("LOW");
    expect(d.caveats.find((c) => c.code === "caveat.unverifiedRuleWording")!.params.rules).toContain("E6");
  });

  it("is deterministic and evaluates all ten factors in order", () => {
    const s = scenario({ price: 60 });
    expect(evaluateDecision(s.inputs)).toEqual(s.decision);
    expect(s.decision.factors.map((f) => f.id)).toEqual(FACTOR_IDS);
  });

  it("states when the statements become stale (fiscal period end + stale months)", () => {
    const { decision: d } = scenario({ price: 60 });
    expect(d.conditions.find((c) => c.code === "cond.statementsBecomeStale")!.params.date).toBe("2026-12-31");
  });
});

describe("decision engine — every code is translated", () => {
  const variants = [
    scenario({ price: 60 }),
    scenario({ price: 100 }),
    scenario({ price: 200, intrinsicEnabled: false }),
    scenario({ price: 1000 }),
    scenario({ price: 60, annual: withDeficit() }),
    scenario({ price: 60, annual: withDeficit(), position: {} }),
    scenario({ price: 100, position: { weight: 0.35, thesisStrategy: null } }),
    scenario({ price: 160, position: {}, intrinsicEnabled: false }),
    scenario({ price: 60, gate: { missing: ["price", "concept:revenue"], stale: ["financials"], conflicting: ["x"], notes: ["DEV_FIXTURE"] } }),
    scenario({ price: 60, strategy: "NET_NET", industry: { sicCode: "6022" } }),
    scenario({ price: 60, strategy: "ENTERPRISING", verification: null }),
    scenario({ price: 60, annual: soundCompany().slice(-6) }),
    scenario({ price: 60, intrinsicEnabled: false, settings: { requireIntrinsicMarginOfSafety: true } }),
    scenario({ price: null }),
  ].map((s) => s.decision);

  it("covers all six categories", () => {
    const seen = new Set(variants.map((d) => d.category));
    for (const c of DECISION_CATEGORIES) expect(seen.has(c), c).toBe(true);
  });

  it.each(["he", "en"] as const)("%s: statements and factor reasons render without raw codes or placeholders", (locale) => {
    const dict = getDictionary(locale);
    for (const d of variants) {
      for (const s of [...d.reasons, ...d.reviewTriggers, ...d.caveats, ...d.conditions]) {
        expect(dict.decision.statements, s.code).toHaveProperty([s.code]);
        const text = renderStatement(s, dict, locale, "USD");
        expect(text, s.code).not.toMatch(/\{\w+\}/);
      }
      for (const f of d.factors) {
        expect(dict.decision.factorReasons, f.reason).toHaveProperty([f.reason]);
        expect(renderFactorReason(f, dict, locale, "USD"), f.reason).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
