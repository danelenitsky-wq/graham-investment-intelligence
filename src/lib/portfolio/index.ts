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
  /**
   * Trades behind the position (in `currency`), used to convert the cost
   * basis at the FX rates of the trade dates. Used only when they reconcile
   * with `quantity` and `averageCost`; otherwise `openedAt` is used.
   */
  trades?: CostTrade[];
  /** Purchase date of the whole position, the fallback date for the historical cost rate. */
  openedAt?: string | null;
}

export interface CostTrade {
  type: "BUY" | "SELL";
  /** Trade date (YYYY-MM-DD); null when the user gave none (then no FX rate can be chosen for it). */
  date: string | null;
  quantity: number;
  /** Price per share in the holding currency (major unit). */
  price: number;
}

/** Why a holding's cost cannot be expressed in the base currency at historical rates. */
export type HistoricalCostIssue =
  | { reason: "NO_PURCHASE_DATE" }
  | { reason: "HISTORICAL_FX_UNAVAILABLE"; date: string; fx: FxUnavailableReason };

export interface HistoricalCost {
  /** Cost basis in the base currency at the FX rates of the purchase dates. */
  costInBase: number;
  /** "TRADES": per trade date (average-cost method for sales); "OPENED_AT": one rate at the position's purchase date. */
  basis: "TRADES" | "OPENED_AT" | "SAME_CURRENCY";
  /** Rates used, one per purchase date (empty for the base currency). */
  conversions: FxConversion[];
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
  /** Cost converted at the rates of the purchase dates; null with `historicalCostIssue` when not possible. */
  historicalCost: HistoricalCost | null;
  historicalCostIssue: HistoricalCostIssue | null;
  /**
   * Unrealized P/L in the base currency = market value at today's rate − cost at
   * the purchase-date rates, split into the part from the price move (measured
   * at today's rate) and the part from the currency move on the original cost.
   */
  pnlInBase: { total: number; priceEffect: number; fxEffect: number } | null;
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
  /** Market value of priced holdings at today's rates. */
  marketValue: number;
  /**
   * Cost of the priced holdings at the FX rates of their purchase dates.
   * Null when any foreign-currency holding lacks a purchase date or a rate for
   * it (see `pnlBlocked`): then no consolidated P/L is shown at all.
   */
  pricedCost: number | null;
  unrealizedPnl: number | null;
  unrealizedReturn: number | null;
  /** Part of the unrealized P/L from price moves (valued at today's rates). */
  priceEffect: number | null;
  /** Part of the unrealized P/L from currency moves since purchase. */
  fxEffect: number | null;
  /** Cost converted at today's rates, shown for comparison only (not used for P/L). */
  pricedCostAtCurrentRates: number;
  /** Current rates used for market values. */
  conversions: FxConversion[];
  pnlBlocked: { holdingId: string; ticker: string; issue: HistoricalCostIssue }[];
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
      historicalCost: null,
      historicalCostIssue: null,
      pnlInBase: null,
    };
  });
  for (const h of holdings) {
    const r = historicalCost(h, costBasisOf(h), options.baseCurrency, options.fxRates, options.fxPolicy);
    if (r.ok) h.historicalCost = r.cost;
    else h.historicalCostIssue = r.issue;
  }

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
    const current = (c: Currency) => (c === options.baseCurrency ? 1 : conversions.find((x) => x.from === c)!.factor);
    const priced = holdings.filter((h) => h.marketValue !== null);
    const mv = priced.reduce((s, h) => s + h.marketValue! * current(h.currency), 0);
    const costNow = priced.reduce((s, h) => s + h.costBasis * current(h.currency), 0);
    const pnlBlocked: ConsolidatedTotals["pnlBlocked"] = [];
    let cost = 0;
    let priceEffect = 0;
    let fxEffect = 0;
    for (const h of priced) {
      if (!h.historicalCost) {
        pnlBlocked.push({ holdingId: h.id, ticker: h.ticker, issue: h.historicalCostIssue ?? { reason: "NO_PURCHASE_DATE" } });
        continue;
      }
      const f = current(h.currency);
      const pe = (h.marketValue! - h.costBasis) * f;
      const fe = h.costBasis * f - h.historicalCost.costInBase;
      h.pnlInBase = { total: pe + fe, priceEffect: pe, fxEffect: fe };
      cost += h.historicalCost.costInBase;
      priceEffect += pe;
      fxEffect += fe;
    }
    const ok = pnlBlocked.length === 0;
    consolidated = {
      baseCurrency: options.baseCurrency,
      marketValue: mv,
      pricedCost: ok ? cost : null,
      unrealizedPnl: ok ? mv - cost : null,
      unrealizedReturn: ok && cost !== 0 ? (mv - cost) / cost : null,
      priceEffect: ok ? priceEffect : null,
      fxEffect: ok ? fxEffect : null,
      pricedCostAtCurrentRates: costNow,
      conversions,
      pnlBlocked,
    };
    for (const h of holdings) {
      if (h.marketValue === null || mv === 0) continue;
      const conv = h.currency === options.baseCurrency ? null : conversions.find((x) => x.from === h.currency)!;
      h.weight = (conv ? convert(h.marketValue, conv) : h.marketValue) / mv;
    }
  }
  return { holdings, byCurrency, consolidated, consolidationBlocked: blocked, baseCurrency: options.baseCurrency };
}

const costBasisOf = (h: HoldingInput) => h.quantity * h.averageCost;

/** Relative tolerance for reconciling trades with the stored position. */
const RECONCILE_TOLERANCE = 1e-6;
const close = (a: number, b: number) => Math.abs(a - b) <= RECONCILE_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Cost basis in the base currency at the FX rates of the purchase dates.
 *
 * With trades that reconcile with the position (same remaining quantity and
 * cost), each purchase is converted at the rate of its own date and sales
 * remove cost in proportion (average-cost method), in both currencies. When
 * they do not reconcile, the whole cost is converted at the position's
 * purchase date. A missing date or rate makes the result unavailable: no
 * rate is ever taken from another period than the purchase.
 */
export function historicalCost(
  h: Pick<HoldingInput, "currency" | "quantity" | "averageCost" | "trades" | "openedAt">,
  costBasis: number,
  base: Currency,
  fxRates: FxRateRecord[],
  policy?: FxPolicy,
): { ok: true; cost: HistoricalCost } | { ok: false; issue: HistoricalCostIssue } {
  if (h.currency === base) return { ok: true, cost: { costInBase: costBasis, basis: "SAME_CURRENCY", conversions: [] } };
  const rateAt = (date: string) => resolveFx(h.currency, base, fxRates, date, policy);

  // A purchase without a known date cannot be converted at its own rate, and no other date may stand in for it.
  if ((h.trades ?? []).some((t) => t.type === "BUY" && t.date === null)) return { ok: false, issue: { reason: "NO_PURCHASE_DATE" } };
  const trades = [...(h.trades ?? [])].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.type === b.type ? 0 : a.type === "BUY" ? -1 : 1));
  if (trades.length) {
    let qty = 0;
    let local = 0;
    let inBase = 0;
    let missing: HistoricalCostIssue | null = null;
    const used = new Map<string, FxConversion>();
    let valid = true;
    for (const t of trades) {
      if (!(t.quantity > 0) || !(t.price >= 0)) {
        valid = false;
        break;
      }
      if (t.type === "BUY") {
        const r = rateAt(t.date!);
        if (!r.ok) {
          missing ??= { reason: "HISTORICAL_FX_UNAVAILABLE", date: t.date!, fx: r.reason };
          continue;
        }
        used.set(r.conversion.rate.date + r.conversion.rate.kind, r.conversion);
        qty += t.quantity;
        local += t.quantity * t.price;
        inBase += t.quantity * t.price * r.conversion.factor;
      } else {
        if (t.quantity > qty + RECONCILE_TOLERANCE * Math.max(1, qty)) {
          valid = false;
          break;
        }
        const keep = qty === 0 ? 0 : 1 - t.quantity / qty;
        qty -= t.quantity;
        local *= keep;
        inBase *= keep;
      }
    }
    if (valid && missing) return { ok: false, issue: missing };
    if (valid && close(qty, h.quantity) && close(local, costBasis)) {
      return { ok: true, cost: { costInBase: inBase, basis: "TRADES", conversions: [...used.values()] } };
    }
  }
  if (!h.openedAt) return { ok: false, issue: { reason: "NO_PURCHASE_DATE" } };
  const r = rateAt(h.openedAt);
  if (!r.ok) return { ok: false, issue: { reason: "HISTORICAL_FX_UNAVAILABLE", date: h.openedAt, fx: r.reason } };
  return { ok: true, cost: { costInBase: costBasis * r.conversion.factor, basis: "OPENED_AT", conversions: [r.conversion] } };
}

export type { Currency } from "./currency";
export type { FxRateRecord, FxConversion, FxPolicy } from "./fx";
