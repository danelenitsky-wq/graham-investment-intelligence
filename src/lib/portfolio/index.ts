/**
 * Portfolio management calculations (pure). Market values are computed only
 * from real prices; a position without a price has an unknown (null) value
 * and is excluded from weights, never valued at cost or zero.
 */
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
