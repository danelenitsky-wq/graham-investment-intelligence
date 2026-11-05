import { describe, expect, it } from "vitest";
import { fundamentalsFreshness, priceFreshness, validateAnnualFinancials } from "@/lib/freshness";
import { valuePortfolio } from "@/lib/portfolio";
import { year } from "./helpers";

describe("freshness", () => {
  it("grades price age", () => {
    expect(priceFreshness("2025-03-03", "2025-03-04", false).level).toBe("FRESH");
    expect(priceFreshness("2025-02-25", "2025-03-04", false).level).toBe("AGING");
    expect(priceFreshness("2025-01-01", "2025-03-04", false).level).toBe("STALE");
    expect(priceFreshness(null, "2025-03-04", false).level).toBe("MISSING");
  });
  it("grades fundamentals by months since fiscal year end", () => {
    expect(fundamentalsFreshness("2024-12-31", "2025-06-01", false).level).toBe("FRESH");
    expect(fundamentalsFreshness("2023-12-31", "2025-06-01", false).level).toBe("AGING");
    expect(fundamentalsFreshness("2021-12-31", "2025-06-01", false).level).toBe("STALE");
  });
});

describe("validation", () => {
  it("flags balance sheet mismatches, gaps and share jumps", () => {
    const issues = validateAnnualFinancials([
      year(2020, { totalAssets: 100, totalLiabilities: 40, stockholdersEquity: 60, dilutedShares: 10 }),
      year(2022, { totalAssets: 100, totalLiabilities: 40, stockholdersEquity: 50, dilutedShares: 25 }),
    ]);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("BALANCE_SHEET_MISMATCH");
    expect(codes).toContain("MISSING_FISCAL_YEARS");
    expect(codes).toContain("SHARE_COUNT_JUMP");
  });
});

describe("portfolio", () => {
  it("excludes unpriced and foreign-currency positions from totals instead of guessing", () => {
    const s = valuePortfolio("USD", [
      { id: "a", ticker: "AAA", quantity: 10, averageCost: 50, currency: "USD", lastPrice: 60, lastPriceDate: "2025-01-02" },
      { id: "b", ticker: "BBB", quantity: 5, averageCost: 20, currency: "USD", lastPrice: null, lastPriceDate: null },
      { id: "c", ticker: "CCC", quantity: 1, averageCost: 100, currency: "ILS", lastPrice: 110, lastPriceDate: "2025-01-02" },
    ]);
    expect(s.totalMarketValue).toBe(600);
    expect(s.unrealizedPnl).toBe(100);
    expect(s.unpricedPositions).toBe(1);
    expect(s.foreignCurrencyPositions).toBe(1);
    expect(s.positions.find((p) => p.id === "a")!.weight).toBe(1);
    expect(s.positions.find((p) => p.id === "b")!.marketValue).toBeNull();
  });
});
