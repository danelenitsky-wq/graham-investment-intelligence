import { describe, expect, it } from "vitest";
import { MAX_DEFAULT_GROWTH_PERCENT, valueWithGraham } from "@/lib/valuation/graham";
import { bondYieldAdjustedFormula } from "@/lib/valuation/modern";
import { decideAccess, type AccessConfig } from "@/lib/security/access";
import { year } from "./helpers";

/** EPS compounding at `g` a year for 12 years ending 2025, with a positive balance sheet. */
function grower(g: number) {
  return Array.from({ length: 12 }, (_, i) =>
    year(2014 + i, { epsDiluted: 1 * Math.pow(1 + g, i), netIncome: 1e9, stockholdersEquity: 5e9, sharesOutstanding: 1e9, currentAssets: 4e9, totalLiabilities: 2e9 }),
  );
}

describe("Graham growth formula: default G is bounded (audit 2026-11-06)", () => {
  it("uses historical growth up to the formula range", () => {
    const v = valueWithGraham({ annual: grower(0.1), price: 10 });
    const est = v.estimates.find((e) => e.id === "graham.growthFormula")!;
    expect(v.growthSource).toBe("HISTORICAL");
    expect(v.rejectedHistoricalGrowth).toBeNull();
    expect(est.status).toBe("OK");
    expect(v.growthPercentUsed!).toBeCloseTo(10, 5);
  });

  it("produces no default estimate when past growth is above the range (no extrapolated boom)", () => {
    const v = valueWithGraham({ annual: grower(0.6), price: 10 });
    const est = v.estimates.find((e) => e.id === "graham.growthFormula")!;
    expect(v.rejectedHistoricalGrowth!).toBeGreaterThan(MAX_DEFAULT_GROWTH_PERCENT);
    expect(v.growthPercentUsed).toBeNull();
    expect(v.growthSource).toBe("NONE");
    expect(est.status).toBe("NOT_MEANINGFUL");
    expect(est.value).toBeNull();
    expect(est.reason).toBe("growthAboveFormulaRange");
    expect(v.marginsOfSafety["graham.growthFormula"]).toBeNull();
    const modern = bondYieldAdjustedFormula({ earnings: v.normalEarnings, growthPercent: v.growthPercentUsed, aaaYieldPercent: 5, rejectedHistoricalGrowth: v.rejectedHistoricalGrowth });
    expect(modern.status).toBe("NOT_MEANINGFUL");
  });

  it("still computes with an explicit user G, and ignores out-of-range overrides", () => {
    const ok = valueWithGraham({ annual: grower(0.6), price: 10, growthPercentOverride: 12 });
    expect(ok.growthSource).toBe("USER");
    expect(ok.estimates.find((e) => e.id === "graham.growthFormula")!.status).toBe("OK");
    const bad = valueWithGraham({ annual: grower(0.1), price: 10, growthPercentOverride: 900 });
    expect(bad.growthSource).toBe("HISTORICAL");
    expect(bad.growthPercentUsed!).toBeCloseTo(10, 5);
  });
});

describe("access control", () => {
  const cfg = (o: Partial<AccessConfig> = {}): AccessConfig => ({ username: "graham", password: "correct horse battery", disabled: false, production: true, ...o });
  const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

  it("challenges without or with wrong credentials, allows the right ones", () => {
    expect(decideAccess("/he/portfolio", null, cfg())).toBe("CHALLENGE");
    expect(decideAccess("/he/portfolio", basic("graham", "nope"), cfg())).toBe("CHALLENGE");
    expect(decideAccess("/he/portfolio", basic("other", "correct horse battery"), cfg())).toBe("CHALLENGE");
    expect(decideAccess("/he/portfolio", basic("graham", "correct horse battery"), cfg())).toBe("ALLOW");
  });

  it("protects API routes and ticker paths that contain a dot", () => {
    expect(decideAccess("/api/quote/abc", null, cfg())).toBe("CHALLENGE");
    expect(decideAccess("/he/stocks/NYSE/BRK.B", null, cfg())).toBe("CHALLENGE");
  });

  it("leaves the health probe and the secret-protected cron routes to their own checks", () => {
    expect(decideAccess("/api/health", null, cfg())).toBe("ALLOW");
    expect(decideAccess("/api/cron/check-filings", null, cfg())).toBe("ALLOW");
    expect(decideAccess("/api/healthz", null, cfg())).toBe("CHALLENGE");
  });

  it("refuses to run unprotected in production unless explicitly disabled", () => {
    expect(decideAccess("/he", null, cfg({ password: null }))).toBe("MISCONFIGURED");
    expect(decideAccess("/he", null, cfg({ password: null, disabled: true }))).toBe("ALLOW");
    expect(decideAccess("/he", null, cfg({ password: null, production: false }))).toBe("ALLOW");
  });
});
