import { describe, expect, it } from "vitest";
import { etfMetrics, type EtfBar } from "@/lib/portfolio/etf";

const DAY = 86_400_000;
function bars(from: string, to: string, close: (i: number) => number, adj: (i: number) => number | null = close): EtfBar[] {
  const out: EtfBar[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"), i = 0; t <= Date.parse(to + "T00:00:00Z"); t += DAY, i++) out.push({ date: new Date(t).toISOString().slice(0, 10), close: close(i), adjClose: adj(i) });
  return out;
}

describe("ETF metrics", () => {
  const history = bars("2023-11-01", "2026-11-05", (i) => 100 + i * 0.01);

  it("computes TTM distribution yield, total returns and 52-week range from stored data", () => {
    const m = etfMetrics({ bars: history, dividends: [{ exDate: "2026-03-20", amount: 1 }, { exDate: "2026-09-20", amount: 1.2 }, { exDate: "2025-09-20", amount: 5 }], price: 110, priceDate: "2026-11-05" });
    expect(m.distributionsTtm).toBeCloseTo(2.2, 12);
    expect(m.distributionCountTtm).toBe(2);
    expect(m.distributionYieldTtm).toBeCloseTo(2.2 / 110, 12);
    expect(m.totalReturn1y).toBeGreaterThan(0);
    expect(m.totalReturn3y).toBeGreaterThan(m.totalReturn1y!);
    expect(m.yearHigh).toBeCloseTo(history.at(-1)!.close, 9);
    expect(m.distanceFromHigh).toBeCloseTo(110 / history.at(-1)!.close - 1, 9);
    expect(m.excludedDistributions).toBe(0);
  });

  it("removes share distributions recorded as dividends (the GOOGL 2014 case)", () => {
    const m = etfMetrics({ bars: history, dividends: [{ exDate: "2026-04-02", amount: 567.97 }, { exDate: "2026-06-01", amount: 0.5 }], price: 110, priceDate: "2026-11-05" });
    expect(m.excludedDistributions).toBe(1);
    expect(m.distributionsTtm).toBe(0.5);
  });

  it("states no yield, range or returns without enough history or adjusted closes", () => {
    const short = bars("2026-06-01", "2026-11-05", () => 50, () => null);
    const m = etfMetrics({ bars: short, dividends: [], price: 50, priceDate: "2026-11-05" });
    expect(m).toMatchObject({ distributionYieldTtm: null, distributionsTtm: null, yearHigh: null, totalReturn1y: null, totalReturn3y: null, distanceFromHigh: null });
    expect(etfMetrics({ bars: [], dividends: [], price: null, priceDate: null }).asOf).toBeNull();
  });
});
