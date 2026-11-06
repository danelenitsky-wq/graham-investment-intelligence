/**
 * Portfolio management calculations (pure). Market values are computed only
 * from real prices; a position without a price has an unknown (null) value
 * and is excluded from weights, never valued at cost or zero.
 */
import type { Currency } from "./currency";
import { convert, resolveFx, type FxConversion, type FxPolicy, type FxRateRecord, type FxUnavailableReason } from "./fx";

export interface PositionInput {
  id: string;
  ticker: string;
  quantity: number;
  averageCost: number;
  currency: string;
  /** Latest close in the position currency, or null when unavailable. */
  lastPrice: number | null;
  lastPriceDate: string | null;
}

export interface PositionValuation extends PositionInput {
  costBasis: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  weight: number | null;
}

export interface PortfolioSummary {
  currency: string;
  positions: PositionValuation[];
  totalCost: number;
  /** Sum over priced positions only. */
  totalMarketValue: number | null;
  pricedCost: number;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  unpricedPositions: number;
  /** Positions in a different currency than the portfolio are excluded from totals. */
  foreignCurrencyPositions: number;
}

export function valuePortfolio(baseCurrency: string, positions: PositionInput[]): PortfolioSummary {
  const valued = positions.map((p) => {
    const costBasis = p.quantity * p.averageCost;
    const marketValue = p.lastPrice === null ? null : p.quantity * p.lastPrice;
    const unrealizedPnl = marketValue === null ? null : marketValue - costBasis;
    return {
      ...p,
      costBasis,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct: unrealizedPnl === null || costBasis === 0 ? null : unrealizedPnl / costBasis,
      weight: null as number | null,
    };
  });
  const inBase = valued.filter((p) => p.currency === baseCurrency);
  const priced = inBase.filter((p) => p.marketValue !== null);
  const totalMarketValue = priced.length ? priced.reduce((s, p) => s + p.marketValue!, 0) : null;
  const pricedCost = priced.reduce((s, p) => s + p.costBasis, 0);
  for (const p of valued) {
    if (p.currency === baseCurrency && p.marketValue !== null && totalMarketValue) p.weight = p.marketValue / totalMarketValue;
  }
  const unrealizedPnl = totalMarketValue === null ? null : totalMarketValue - pricedCost;
  return {
    currency: baseCurrency,
    positions: valued,
    totalCost: inBase.reduce((s, p) => s + p.costBasis, 0),
    totalMarketValue,
    pricedCost,
    unrealizedPnl,
    unrealizedPnlPct: unrealizedPnl === null || pricedCost === 0 ? null : unrealizedPnl / pricedCost,
    unpricedPositions: inBase.length - priced.length,
    foreignCurrencyPositions: valued.length - inBase.length,
  };
}

// ───────────────────────── Multi-currency holdings ─────────────────────────


export interface HoldingInput {
  id: string;
  ticker: string;
  quantity: number;
  /** Average purchase price per share, in the major unit of `currency`. */
  averageCost: number;
  currency: Currency;
  /** Latest available price (major unit) and its currency; null when there is none. */
  lastPrice: number | null;
  lastPriceCurrency: string | null;
  /** 52-week high in the price currency, when known. */
  yearHigh?: number | null;
}

export type UnpricedReason = "NO_PRICE" | "PRICE_CURRENCY_MISMATCH";

export interface HoldingValuation extends HoldingInput {
  costBasis: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedReturn: number | null;
  /** Share of the priced market value in the same currency (0–1). */
  weightInCurrency: number | null;
  /** Share of the whole portfolio, only when every priced holding converts with a sourced FX rate. */
  weight: number | null;
  /** price / 52-week high − 1 (≤ 0 normally); null when either is unknown. */
  distanceFromHigh: number | null;
  unpricedReason: UnpricedReason | null;
}

export interface CurrencyTotals {
  currency: Currency;
  positions: number;
  /** Cost of every position in this currency. */
  totalCost: number;
  /** Cost of the priced positions only (the base of unrealized P/L). */
  pricedCost: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedReturn: number | null;
  unpriced: number;
}

export interface ConsolidatedTotals {
  baseCurrency: Currency;
  marketValue: number;
  pricedCost: number;
  unrealizedPnl: number;
  unrealizedReturn: number | null;
  conversions: FxConversion[];
}

export interface HoldingsSummary {
  holdings: HoldingValuation[];
  byCurrency: CurrencyTotals[];
  /** Null when a currency cannot be converted with a sourced rate (see `consolidationBlocked`). */
  consolidated: ConsolidatedTotals | null;
  consolidationBlocked: { from: Currency; reason: FxUnavailableReason }[];
  baseCurrency: Currency;
}

export function valueHoldings(
  inputs: HoldingInput[],
  options: { baseCurrency: Currency; fxRates: FxRateRecord[]; asOf: string; fxPolicy?: FxPolicy },
): HoldingsSummary {
  const holdings: HoldingValuation[] = inputs.map((h) => {
    const costBasis = h.quantity * h.averageCost;
    const mismatch = h.lastPrice !== null && h.lastPriceCurrency !== null && h.lastPriceCurrency !== h.currency;
    const price = h.lastPrice !== null && !mismatch ? h.lastPrice : null;
    const marketValue = price === null ? null : h.quantity * price;
    const unrealizedPnl = marketValue === null ? null : marketValue - costBasis;
    const yh = h.yearHigh ?? null;
    return {
      ...h,
      costBasis,
      marketValue,
      unrealizedPnl,
      unrealizedReturn: unrealizedPnl === null || costBasis === 0 ? null : unrealizedPnl / costBasis,
      weightInCurrency: null,
      weight: null,
      distanceFromHigh: price !== null && yh !== null && yh > 0 ? price / yh - 1 : null,
      unpricedReason: h.lastPrice === null ? "NO_PRICE" : mismatch ? "PRICE_CURRENCY_MISMATCH" : null,
    };
  });

  const currencies = [...new Set(holdings.map((h) => h.currency))].sort((a, b) => (a === options.baseCurrency ? -1 : b === options.baseCurrency ? 1 : a.localeCompare(b)));
  const byCurrency: CurrencyTotals[] = currencies.map((c) => {
    const group = holdings.filter((h) => h.currency === c);
    const priced = group.filter((h) => h.marketValue !== null);
    const marketValue = priced.length ? priced.reduce((s, h) => s + h.marketValue!, 0) : null;
    const pricedCost = priced.reduce((s, h) => s + h.costBasis, 0);
    for (const h of priced) h.weightInCurrency = marketValue ? h.marketValue! / marketValue : null;
    const unrealizedPnl = marketValue === null ? null : marketValue - pricedCost;
    return {
      currency: c,
      positions: group.length,
      totalCost: group.reduce((s, h) => s + h.costBasis, 0),
      pricedCost,
      marketValue,
      unrealizedPnl,
      unrealizedReturn: unrealizedPnl === null || pricedCost === 0 ? null : unrealizedPnl / pricedCost,
      unpriced: group.length - priced.length,
    };
  });

  const conversions: FxConversion[] = [];
  const blocked: HoldingsSummary["consolidationBlocked"] = [];
  for (const t of byCurrency) {
    if (t.marketValue === null) continue;
    const r = resolveFx(t.currency, options.baseCurrency, options.fxRates, options.asOf, options.fxPolicy);
    if (r.ok) {
      if (t.currency !== options.baseCurrency) conversions.push(r.conversion);
    } else blocked.push({ from: t.currency, reason: r.reason });
  }

  let consolidated: ConsolidatedTotals | null = null;
  const pricedTotals = byCurrency.filter((t) => t.marketValue !== null);
  if (pricedTotals.length && blocked.length === 0) {
    const factor = (c: Currency) => (c === options.baseCurrency ? 1 : conversions.find((x) => x.from === c)!.factor);
    const mv = pricedTotals.reduce((s, t) => s + t.marketValue! * factor(t.currency), 0);
    const cost = pricedTotals.reduce((s, t) => s + t.pricedCost * factor(t.currency), 0);
    consolidated = {
      baseCurrency: options.baseCurrency,
      marketValue: mv,
      pricedCost: cost,
      unrealizedPnl: mv - cost,
      unrealizedReturn: cost === 0 ? null : (mv - cost) / cost,
      conversions,
    };
    for (const h of holdings) {
      if (h.marketValue === null || mv === 0) continue;
      const conv = h.currency === options.baseCurrency ? null : conversions.find((x) => x.from === h.currency)!;
      h.weight = (conv ? convert(h.marketValue, conv) : h.marketValue) / mv;
    }
  }
  return { holdings, byCurrency, consolidated, consolidationBlocked: blocked, baseCurrency: options.baseCurrency };
}

export type { Currency } from "./currency";
export type { FxRateRecord, FxConversion, FxPolicy } from "./fx";
