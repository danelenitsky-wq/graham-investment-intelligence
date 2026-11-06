import { describe, expect, it } from "vitest";
import { parseCurrency, parsePriceUnit, roundTo, toMajorUnit } from "@/lib/portfolio/currency";
import { resolveFx, type FxRateRecord } from "@/lib/portfolio/fx";
import { historicalCost, valueHoldings, type HoldingInput } from "@/lib/portfolio";

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

  it("consolidates market value with the current official rate and records the conversion used", () => {
    const s = valueHoldings([usd, ils], { baseCurrency: "USD", fxRates: [boi("2026-11-05", 3)], asOf: "2026-11-06" });
    expect(s.consolidated?.marketValue).toBeCloseTo(600 + 2000, 9);
    expect(s.consolidated?.pricedCostAtCurrentRates).toBeCloseTo(500 + 5230 / 3, 9);
    expect(s.consolidated?.conversions).toHaveLength(1);
    expect(s.holdings.find((h) => h.id === "b")?.weight).toBeCloseTo(2000 / 2600, 12);
    // No purchase date for the ILS holding: no consolidated P/L rather than one at today's rate.
    expect(s.consolidated).toMatchObject({ pricedCost: null, unrealizedPnl: null, unrealizedReturn: null, fxEffect: null });
    expect(s.consolidated?.pnlBlocked).toEqual([{ holdingId: "b", ticker: "TEVA", issue: { reason: "NO_PURCHASE_DATE" } }]);
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

describe("consolidated unrealized P/L with historical currency effects", () => {
  // Bought 100 TEVA at ₪40 when 1 USD = ₪4.00 (cost $1,000). Now ₪50 and 1 USD = ₪3.20.
  const tevaBuy = { type: "BUY" as const, date: "2024-03-01", quantity: 100, price: 40 };
  const teva: HoldingInput = { id: "t", ticker: "TEVA", quantity: 100, averageCost: 40, currency: "ILS", lastPrice: 50, lastPriceCurrency: "ILS", trades: [tevaBuy] };
  const ko: HoldingInput = { id: "k", ticker: "KO", quantity: 10, averageCost: 50, currency: "USD", lastPrice: 60, lastPriceCurrency: "USD" };
  const rates = [boi("2024-02-29", 4), boi("2026-11-05", 3.2)];
  const asOf = "2026-11-06";

  it("converts the cost at the purchase-date rate and the value at today's rate", () => {
    const s = valueHoldings([ko, teva], { baseCurrency: "USD", fxRates: rates, asOf });
    const c = s.consolidated!;
    // Value: 600 + 5000 / 3.2 = 2162.5. Cost: 500 + 4000 / 4 = 1500.
    expect(c.marketValue).toBeCloseTo(2162.5, 9);
    expect(c.pricedCost).toBeCloseTo(1500, 9);
    expect(c.unrealizedPnl).toBeCloseTo(662.5, 9);
    expect(c.unrealizedReturn).toBeCloseTo(662.5 / 1500, 12);
    // The old method (cost at today's rate) would have reported 2162.5 − 1750 = 412.5.
    expect(c.pricedCostAtCurrentRates).toBeCloseTo(1750, 9);
    // Price effect: KO 100 + TEVA ₪1000 / 3.2 = 412.5. FX effect on TEVA cost: 4000/3.2 − 1000 = 250.
    expect(c.priceEffect).toBeCloseTo(412.5, 9);
    expect(c.fxEffect).toBeCloseTo(250, 9);
    expect(c.priceEffect! + c.fxEffect!).toBeCloseTo(c.unrealizedPnl!, 9);
    const t = s.holdings.find((h) => h.id === "t")!;
    expect(t.historicalCost).toMatchObject({ basis: "TRADES", costInBase: 1000 });
    expect(t.historicalCost?.conversions[0].rate.date).toBe("2024-02-29");
    expect(t.pnlInBase?.total).toBeCloseTo(5000 / 3.2 - 1000, 9);
    // Local-currency P/L is unchanged by FX.
    expect(t.unrealizedPnl).toBe(1000);
  });

  it("a currency loss can turn a local gain into a base-currency loss", () => {
    const s = valueHoldings([{ ...teva, lastPrice: 42 }], { baseCurrency: "USD", fxRates: [boi("2024-02-29", 3), boi("2026-11-05", 3.6)], asOf });
    const c = s.consolidated!;
    expect(s.holdings[0].unrealizedPnl).toBeGreaterThan(0); // +₪200
    expect(c.unrealizedPnl).toBeCloseTo(4200 / 3.6 - 4000 / 3, 9); // ≈ −166.67 USD
    expect(c.fxEffect).toBeLessThan(0);
  });

  it("converts each purchase at its own date and removes cost proportionally on sales", () => {
    const trades = [
      { type: "BUY" as const, date: "2024-01-10", quantity: 100, price: 40 },
      { type: "BUY" as const, date: "2025-01-10", quantity: 100, price: 60 },
      { type: "SELL" as const, date: "2025-06-01", quantity: 50, price: 70 },
    ];
    const fx = [boi("2024-01-09", 4), boi("2025-01-09", 3.5)];
    // Remaining 150 shares at the average cost ₪50 (₪7,500).
    const r = historicalCost({ currency: "ILS", quantity: 150, averageCost: 50, trades }, 7500, "USD", fx);
    expect(r.ok).toBe(true);
    // Base cost before the sale: 4000/4 + 6000/3.5 = 2714.2857; 3/4 remain after selling 50 of 200.
    if (r.ok) {
      expect(r.cost.costInBase).toBeCloseTo((1000 + 6000 / 3.5) * 0.75, 9);
      expect(r.cost.conversions).toHaveLength(2);
    }
  });

  it("works in the other direction (ILS base, USD holding)", () => {
    const usdHolding: HoldingInput = { ...ko, trades: [{ type: "BUY", date: "2024-03-01", quantity: 10, price: 50 }] };
    const s = valueHoldings([usdHolding], { baseCurrency: "ILS", fxRates: rates, asOf });
    expect(s.consolidated?.pricedCost).toBeCloseTo(500 * 4, 9);
    expect(s.consolidated?.marketValue).toBeCloseTo(600 * 3.2, 9);
    expect(s.consolidated?.fxEffect).toBeCloseTo(500 * 3.2 - 2000, 9);
  });

  it("falls back to the purchase date of the position when trades do not reconcile", () => {
    const edited: HoldingInput = { ...teva, quantity: 120, trades: [tevaBuy], openedAt: "2024-03-01" };
    const s = valueHoldings([edited], { baseCurrency: "USD", fxRates: rates, asOf });
    expect(s.holdings[0].historicalCost).toMatchObject({ basis: "OPENED_AT" });
    expect(s.consolidated?.pricedCost).toBeCloseTo((120 * 40) / 4, 9);
  });

  it("withholds the consolidated P/L when a purchase-date rate is missing, never using another date's rate", () => {
    const s = valueHoldings([ko, teva], { baseCurrency: "USD", fxRates: [boi("2026-11-05", 3.2), boi("2024-01-01", 4)], asOf });
    const c = s.consolidated!;
    expect(c.marketValue).toBeCloseTo(600 + 5000 / 3.2, 9); // value still shown
    expect(c.unrealizedPnl).toBeNull();
    expect(c.pricedCost).toBeNull();
    expect(c.pnlBlocked).toEqual([{ holdingId: "t", ticker: "TEVA", issue: { reason: "HISTORICAL_FX_UNAVAILABLE", date: "2024-03-01", fx: "RATE_TOO_OLD" } }]);
    // Per-currency figures do not depend on FX.
    expect(s.byCurrency.find((t) => t.currency === "ILS")?.unrealizedPnl).toBe(1000);
  });

  it("refuses a rate dated after the purchase, and invalid rates", () => {
    expect(historicalCost(teva, 4000, "USD", [boi("2024-03-04", 4)])).toEqual({ ok: false, issue: { reason: "HISTORICAL_FX_UNAVAILABLE", date: "2024-03-01", fx: "RATE_AFTER_AS_OF" } });
    expect(historicalCost(teva, 4000, "USD", [boi("2024-02-29", 0)])).toEqual({ ok: false, issue: { reason: "HISTORICAL_FX_UNAVAILABLE", date: "2024-03-01", fx: "INVALID_RATE" } });
    expect(historicalCost(teva, 4000, "USD", [])).toEqual({ ok: false, issue: { reason: "HISTORICAL_FX_UNAVAILABLE", date: "2024-03-01", fx: "NO_RATE" } });
  });

  it("uses a manual rate for the purchase date when no official one exists, and prefers official on the same date", () => {
    const m = historicalCost(teva, 4000, "USD", [manual("2024-03-01", 3.9)]);
    expect(m.ok && m.cost.costInBase).toBeCloseTo(4000 / 3.9, 9);
    const both = historicalCost(teva, 4000, "USD", [manual("2024-03-01", 3.9), boi("2024-03-01", 4)]);
    expect(both.ok && both.cost.conversions[0].rate.kind).toBe("OFFICIAL");
  });

  it("an undated purchase (imported without a purchase date) blocks the P/L even when the position has another date", () => {
    const undated: HoldingInput = { ...teva, quantity: 200, trades: [tevaBuy, { type: "BUY", date: null, quantity: 100, price: 40 }], openedAt: "2024-03-01" };
    const s = valueHoldings([undated], { baseCurrency: "USD", fxRates: rates, asOf });
    expect(s.holdings[0].historicalCostIssue).toEqual({ reason: "NO_PURCHASE_DATE" });
    expect(s.consolidated?.unrealizedPnl).toBeNull();
  });

  it("a base-currency-only portfolio has no FX effect", () => {
    const s = valueHoldings([ko], { baseCurrency: "USD", fxRates: [], asOf });
    expect(s.consolidated).toMatchObject({ pricedCost: 500, unrealizedPnl: 100, fxEffect: 0, priceEffect: 100, pnlBlocked: [] });
  });
});
