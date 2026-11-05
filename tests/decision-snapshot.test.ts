import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot, compareSnapshots, stableHash, type SnapshotSource } from "@/lib/decision";
import { scenario, soundCompany, type ScenarioOptions } from "./decision-fixtures";

const versions = { graham: "2.0.0", valuationDashboard: "1.0.0", intrinsicModel: "1.0.0", decision: "1.0.0", report: "1.0.0" };

function snap(o: ScenarioOptions, createdAt = "2025-03-03T12:00:00Z", retrievedAt = "2025-03-03T10:00:00Z") {
  const s = scenario(o);
  const sources: SnapshotSource[] = s.annual.map((a) => ({ kind: "FILING", label: `SEC EDGAR 10-K FY${a.fiscalYear}`, period: a.periodEnd, url: null, reference: `acc-${a.fiscalYear}`, retrievedAt }));
  return buildDecisionSnapshot({
    createdAt,
    trigger: "MANUAL",
    security: { id: "sec1", ticker: "SYNT", exchangeCode: "TEST", name: "Synthetic", cik: null },
    graham: s.graham,
    dashboard: s.dashboard,
    intrinsic: s.intrinsic,
    marginOfSafetyTarget: s.inputs.marginOfSafetyTarget,
    decision: s.decision,
    decisionSettings: s.inputs.settings,
    annual: s.annual,
    position: s.inputs.position,
    gate: s.inputs.gate,
    sources,
    versions,
  });
}

describe("decision snapshots", () => {
  it("contain inputs, sources, versions, assumptions and the final assessment", () => {
    const x = snap({ price: 60 });
    expect(x.createdAt).toBe("2025-03-03T12:00:00Z");
    expect(x.inputs.price).toMatchObject({ value: 60, currency: "USD", date: "2025-03-03" });
    expect(x.inputs.latestFiscalYear).toBe(2024);
    expect(x.inputs.annual).toHaveLength(12);
    expect(x.sources.length).toBe(22);
    expect(x.versions).toEqual(versions);
    expect(x.assumptions).toMatchObject({ strategy: "DEFENSIVE", marginOfSafetyTarget: 0.3 });
    expect(x.assumptions.intrinsic?.assumptions.discountRate).toBe(0.1);
    expect(x.assumptions.decision.maxPositionWeight).toBe(0.2);
    expect(x.assessment.category).toBe("BUY_CANDIDATE");
    expect(x.rules.D3).toBe("PASS");
    expect(x.metrics.price).toBe(60);
    expect(JSON.parse(JSON.stringify(x))).toEqual(x); // JSON-serializable for storage
  });

  it("hash depends on inputs, not on when the snapshot or the data retrieval happened", () => {
    const a = snap({ price: 60 }, "2025-03-03T12:00:00Z", "2025-03-03T10:00:00Z");
    const b = snap({ price: 60 }, "2025-03-04T08:00:00Z", "2025-03-04T07:00:00Z");
    expect(a.inputsHash).toBe(b.inputsHash);
    expect(snap({ price: 61 }).inputsHash).not.toBe(a.inputsHash);
  });

  it("stableHash ignores key order", () => {
    expect(stableHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(stableHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});

describe("comparison view", () => {
  it("a new price changes the assessment: BUY CANDIDATE → WAIT, driven by PRICE", () => {
    const before = snap({ price: 60 }, "2025-03-03T12:00:00Z");
    const after = snap({ price: 200, priceDate: "2025-06-02" }, "2025-06-02T12:00:00Z");
    const c = compareSnapshots(before, after);
    expect(c.categoryChanged).toBe(true);
    expect(c.from.category).toBe("BUY_CANDIDATE");
    expect(c.to.category).toBe("WAIT");
    expect(c.drivers).toContain("PRICE");
    expect(c.drivers).not.toContain("FINANCIALS");
    expect(c.price).toMatchObject({ from: 60, to: 200, fromDate: "2025-03-03", toDate: "2025-06-02" });
    expect(c.price!.change).toBeCloseTo(200 / 60 - 1, 10);
    expect(c.factorChanges.find((f) => f.id === "valuation")).toMatchObject({ from: "FAVORABLE" });
    expect(c.ruleChanges.map((r) => r.id)).toEqual(expect.arrayContaining(["D6"]));
    expect(c.metricChanges.find((m) => m.key === "price")).toMatchObject({ from: 60, to: 200 });
  });

  it("new financial statements: a deficit year arrives → AVOID, driven by FINANCIALS", () => {
    const base = soundCompany();
    const next = [...base, { ...base[base.length - 1], fiscalYear: 2025, periodEnd: "2025-12-31", values: { ...base[base.length - 1].values, netIncome: -20_000_000, epsDiluted: -2, operatingIncome: -10_000_000 } }];
    const before = snap({ price: 60, annual: base });
    const after = snap({ price: 60, annual: next, priceDate: "2026-03-02" }, "2026-03-02T12:00:00Z");
    const c = compareSnapshots(before, after);
    expect(c.drivers).toContain("FINANCIALS");
    expect(c.filings).toEqual({ fromYear: 2024, toYear: 2025, revised: false });
    expect(c.to.category).toBe("AVOID");
    expect(c.ruleChanges.find((r) => r.id === "D3")).toEqual({ id: "D3", from: "PASS", to: "FAIL" });
  });

  it("restated statements for the same year are reported as a revision", () => {
    const base = soundCompany();
    const restated = base.map((a) => (a.fiscalYear === 2024 ? { ...a, values: { ...a.values, stockholdersEquity: 1_100_000_000 } } : a));
    const c = compareSnapshots(snap({ price: 60, annual: base }), snap({ price: 60, annual: restated }));
    expect(c.filings).toEqual({ fromYear: 2024, toYear: 2024, revised: true });
    expect(c.metricChanges.map((m) => m.key)).toContain("bookValuePerShare");
  });

  it("reports owned-position and assumption changes", () => {
    const c = compareSnapshots(snap({ price: 100 }), snap({ price: 100, position: { weight: 0.35 }, marginOfSafetyTarget: 0.25 }));
    expect(c.drivers).toEqual(expect.arrayContaining(["OWNERSHIP", "ASSUMPTIONS"]));
    expect(c.to.category).toBe("REVIEW_FOR_SALE");
    expect(c.addedTriggers).toEqual(["trigger.concentration"]);
  });

  it("identical inputs → no drivers, no change", () => {
    const c = compareSnapshots(snap({ price: 60 }), snap({ price: 60 }, "2025-03-05T00:00:00Z"));
    expect(c.drivers).toEqual([]);
    expect(c.categoryChanged).toBe(false);
    expect(c.factorChanges).toEqual([]);
    expect(c.metricChanges).toEqual([]);
  });
});
