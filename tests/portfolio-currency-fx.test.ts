import { describe, expect, it } from "vitest";
import { parseCurrency, parsePriceUnit, roundTo, toMajorUnit } from "@/lib/portfolio/currency";
import { resolveFx, type FxRateRecord } from "@/lib/portfolio/fx";
import { valueHoldings, type HoldingInput } from "@/lib/portfolio";

const boi = (date: string, rate: number): FxRateRecord => ({ base: "USD", quote: "ILS", rate, date, kind: "OFFICIAL", sourceLabel: "Bank of Israel" });
const manual = (date: string, rate: number): FxRateRecord => ({ base: "USD", quote: "ILS", rate, date, kind: "MANUAL", sourceLabel: "My bank" });

describe("currencies and price units", () => {
  it("recognizes agorot spellings and never guesses unknown labels", () => {
    expect(parsePriceUnit("agorot")).toBe("ILA");
    expect(parsePriceUnit("אגורות")).toBe("ILA");
    expect(parsePriceUnit("ILA")).toBe("ILA");
    expect(parsePriceUnit("NIS")).toBe("ILS");
    expect(parsePriceUnit("₪")).toBe("ILS");
    expect(parsePriceUnit('ש"ח')).toBe("ILS");
    expect(parsePriceUnit("$")).toBe("USD");
    expect(parsePriceUnit("EUR")).toBeNull();
    expect(parsePriceUnit("")).toBeNull();
    expect(parseCurrency("ILA")).toEqual({ currency: "ILS", impliesAgorot: true });
    expect(parseCurrency("usd")).toEqual({ currency: "USD", impliesAgorot: false });
  });

  it("converts agorot to shekels", () => {
    expect(toMajorUnit(5230, "ILA")).toEqual({ amount: 52.3, currency: "ILS" });
    expect(toMajorUnit(52.3, "ILS")).toEqual({ amount: 52.3, currency: "ILS" });
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
  });
});

describe("FX resolution", () => {
  const asOf = "2026-11-06";

  it("uses the latest official rate on or before the date, either direction", () => {
    const rates = [boi("2026-11-04", 3.15), boi("2026-11-05", 3.167)];
    const r = resolveFx("USD", "ILS", rates, asOf);
    expect(r.ok && r.conversion.factor).toBe(3.167);
    expect(r.ok && r.conversion.ageDays).toBe(1);
    const inv = resolveFx("ILS", "USD", rates, asOf);
    expect(inv.ok && inv.conversion.inverted).toBe(true);
    expect(inv.ok && inv.conversion.factor).toBeCloseTo(1 / 3.167, 12);
  });

  it("prefers an official rate over a manual one of the same date, but not over a newer manual rate", () => {
    expect(resolveFx("USD", "ILS", [manual("2026-11-05", 3.2), boi("2026-11-05", 3.167)], asOf)).toMatchObject({ ok: true, conversion: { rate: { kind: "OFFICIAL" } } });
    expect(resolveFx("USD", "ILS", [manual("2026-11-06", 3.2), boi("2026-11-05", 3.167)], asOf)).toMatchObject({ ok: true, conversion: { rate: { kind: "MANUAL" } } });
    expect(resolveFx("USD", "ILS", [manual("2026-11-06", 3.2)], asOf, { maxAgeDays: 7, allowManual: false })).toEqual({ ok: false, reason: "NO_RATE" });
  });

  it("refuses missing, old, future-dated and invalid rates instead of inventing one", () => {
    expect(resolveFx("USD", "ILS", [], asOf)).toEqual({ ok: false, reason: "NO_RATE" });
    expect(resolveFx("USD", "ILS", [boi("2026-10-20", 3.1)], asOf)).toEqual({ ok: false, reason: "RATE_TOO_OLD" });
    expect(resolveFx("USD", "ILS", [boi("2026-11-09", 3.1)], asOf)).toEqual({ ok: false, reason: "RATE_AFTER_AS_OF" });
    expect(resolveFx("USD", "ILS", [boi("2026-11-05", 0)], asOf)).toEqual({ ok: false, reason: "INVALID_RATE" });
    expect(resolveFx("USD", "USD", [], asOf)).toMatchObject({ ok: true, conversion: { factor: 1 } });
  });
});

describe("holdings valuation", () => {
  const usd: HoldingInput = { id: "a", ticker: "KO", quantity: 10, averageCost: 50, currency: "USD", lastPrice: 60, lastPriceCurrency: "USD", yearHigh: 75 };
  const ils: HoldingInput = { id: "b", ticker: "TEVA", quantity: 100, averageCost: 52.3, currency: "ILS", lastPrice: 60, lastPriceCurrency: "ILS" };

  it("values each holding in its own currency with P/L, return and distance from the 52-week high", () => {
    const s = valueHoldings([usd], { baseCurrency: "USD", fxRates: [], asOf: "2026-11-06" });
    const h = s.holdings[0];
    expect(h).toMatchObject({ costBasis: 500, marketValue: 600, unrealizedPnl: 100, weightInCurrency: 1, weight: 1 });
    expect(h.unrealizedReturn).toBeCloseTo(0.2, 12);
    expect(h.distanceFromHigh).toBeCloseTo(-0.2, 12);
    expect(s.consolidated).toMatchObject({ baseCurrency: "USD", marketValue: 600, unrealizedPnl: 100 });
  });

  it("keeps separate currency totals and no portfolio weights without a sourced FX rate", () => {
    const s = valueHoldings([usd, ils], { baseCurrency: "USD", fxRates: [], asOf: "2026-11-06" });
    expect(s.consolidated).toBeNull();
    expect(s.consolidationBlocked).toEqual([{ from: "ILS", reason: "NO_RATE" }]);
    expect(s.byCurrency.map((t) => [t.currency, t.marketValue])).toEqual([
      ["USD", 600],
      ["ILS", 6000],
    ]);
    expect(s.holdings.every((h) => h.weight === null)).toBe(true);
    expect(s.holdings.map((h) => h.weightInCurrency)).toEqual([1, 1]);
  });

  it("consolidates with the official rate and records the conversion used", () => {
    const s = valueHoldings([usd, ils], { baseCurrency: "USD", fxRates: [boi("2026-11-05", 3)], asOf: "2026-11-06" });
    expect(s.consolidated?.marketValue).toBeCloseTo(600 + 2000, 9);
    expect(s.consolidated?.pricedCost).toBeCloseTo(500 + 5230 / 3, 9);
    expect(s.consolidated?.conversions).toHaveLength(1);
    expect(s.holdings.find((h) => h.id === "b")?.weight).toBeCloseTo(2000 / 2600, 12);
  });

  it("never values a holding with a price in another currency", () => {
    const s = valueHoldings([{ ...ils, lastPriceCurrency: "USD" }], { baseCurrency: "ILS", fxRates: [], asOf: "2026-11-06" });
    expect(s.holdings[0]).toMatchObject({ marketValue: null, unpricedReason: "PRICE_CURRENCY_MISMATCH" });
    expect(s.byCurrency[0]).toMatchObject({ unpriced: 1, marketValue: null, totalCost: 5230 });
    expect(s.consolidated).toBeNull();
  });

  it("excludes unpriced holdings from value and P/L but keeps their cost", () => {
    const s = valueHoldings([usd, { ...usd, id: "c", ticker: "PEP", lastPrice: null, lastPriceCurrency: null }], { baseCurrency: "USD", fxRates: [], asOf: "2026-11-06" });
    expect(s.byCurrency[0]).toMatchObject({ positions: 2, totalCost: 1000, pricedCost: 500, marketValue: 600, unpriced: 1 });
    expect(s.holdings[1]).toMatchObject({ unpricedReason: "NO_PRICE", weight: null });
  });
});
