import "server-only";
import { valueHoldings, valuePortfolio, type HoldingInput, type HoldingsSummary, type HoldingValuation } from "@/lib/portfolio";
import { isCurrency, type Currency } from "@/lib/portfolio/currency";
import { etfMetrics, type EtfMetrics } from "@/lib/portfolio/etf";
import type { DecisionCategory, PositionContext, Strategy } from "@/lib/decision";
import type { ScreenOutcome } from "@/lib/graham/types";
import type { QuoteStatus } from "@/lib/freshness/quote";
import type { DataStatus } from "@/lib/freshness/status";
import { db } from "./db";
import { listFxRates } from "./fx";
import { getQuoteView, type QuoteView } from "./quotes";

export async function getDefaultPortfolio() {
  const existing = await db.portfolio.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return db.portfolio.create({ data: { name: "Main", baseCurrency: "USD" } });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function loadPositions(portfolioId: string) {
  return db.position.findMany({
    where: { portfolioId },
    include: {
      security: {
        include: {
          exchange: true,
          source: true,
          priceBars: { orderBy: { date: "desc" }, take: 1, include: { source: true } },
          quotes: { orderBy: { sourceTimestamp: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Light-weight valuation from stored prices (used by the decision engine for position weight). */
export async function getPortfolioSummary() {
  const portfolio = await getDefaultPortfolio();
  const positions = await loadPositions(portfolio.id);
  const base: Currency = isCurrency(portfolio.baseCurrency) ? portfolio.baseCurrency : "USD";
  const priced = positions.map((p) => {
    const bar = p.security.priceBars[0];
    const quote = p.security.quotes[0];
    // Prefer the latest stored quote when it is newer than the last daily bar.
    const useQuote = quote && (!bar || iso(quote.sourceTimestamp) >= iso(bar.date));
    return {
      p,
      price: useQuote ? Number(quote.price) : bar ? Number(bar.close) : null,
      currency: useQuote ? quote.currency : bar ? bar.currency : null,
      date: useQuote ? iso(quote.sourceTimestamp) : bar ? iso(bar.date) : null,
    };
  });
  const summary = valuePortfolio(
    base,
    priced.map(({ p, price, currency, date }) => ({
      id: p.id,
      ticker: p.security.ticker,
      quantity: Number(p.quantity),
      averageCost: Number(p.averageCost),
      currency: p.currency,
      lastPrice: currency === p.currency ? price : null,
      lastPriceDate: currency === p.currency ? date : null,
    })),
  );
  const holdings = valueHoldings(
    priced.filter(({ p }) => isCurrency(p.currency)).map(({ p, price, currency }) => ({
      id: p.id,
      ticker: p.security.ticker,
      quantity: Number(p.quantity),
      averageCost: Number(p.averageCost),
      currency: p.currency as Currency,
      lastPrice: price,
      lastPriceCurrency: currency,
    })),
    { baseCurrency: base, fxRates: await listFxRates(), asOf: iso(new Date()) },
  );
  const meta = new Map(
    positions.map((p) => [
      p.id,
      { securityId: p.securityId, name: p.security.name, exchangeCode: p.security.exchange.code, isDevFixture: p.security.priceBars[0]?.source.isDevFixture ?? false },
    ]),
  );
  return { portfolio, summary, holdings, meta };
}

export interface HoldingRow extends HoldingValuation {
  securityId: string;
  name: string;
  exchangeCode: string;
  market: "US" | "IL" | "OTHER";
  securityType: string;
  isEtf: boolean;
  isUserEntered: boolean;
  isDevFixture: boolean;
  costInputUnit: string | null;
  openedAt: string | null;
  notes: string | null;
  quote: {
    status: QuoteStatus;
    timestamp: string | null;
    /** Exchange timezone the timestamp is shown in. */
    timezone: string;
    source: string | null;
    manual: QuoteView["manual"];
  };
  pe: number | null;
  pb: number | null;
  /** Graham screens: outcome and passed/applicable counts; NOT_APPLICABLE for ETFs. */
  screens: { defensive: ScreenSummary; enterprising: ScreenSummary; netNet: ScreenSummary };
  valuation: { strategy: Strategy; ceiling: number | null; marginOfSafetyTargetPrice: number | null; intrinsicValue: number | null; marginOfSafetyPercent: number | null; currency: string | null };
  decision: { category: DecisionCategory; strategy: Strategy };
  freshness: { quote: QuoteStatus; fundamentals: DataStatus; gateSufficient: boolean };
  etf: EtfMetrics | null;
}

export interface ScreenSummary {
  outcome: ScreenOutcome;
  passed: number;
  applicable: number;
}

export interface PortfolioDashboard {
  portfolio: { id: string; name: string; baseCurrency: Currency };
  summary: HoldingsSummary;
  rows: HoldingRow[];
  quoteRefresh: { attempted: number; providerCalls: number; budgetReached: boolean } | null;
}

function screenSummary(s: { outcome: ScreenOutcome; rules: { counted: boolean; status: string }[] }): ScreenSummary {
  const counted = s.rules.filter((r) => r.counted);
  return { outcome: s.outcome, passed: counted.filter((r) => r.status === "PASS").length, applicable: counted.filter((r) => r.status !== "NOT_APPLICABLE").length };
}

/**
 * Everything the portfolio dashboard shows, per holding: valuation in the
 * holding's own currency, Graham screens, price ceilings, decision category
 * and freshness. Reads stored data only, unless `refreshQuotes` asks for new
 * quotes (cache policy and the provider budgets still apply; at most
 * `maxProviderCalls` provider requests are made).
 */
export async function getPortfolioDashboard(options: { refreshQuotes?: boolean; maxProviderCalls?: number; now?: Date } = {}): Promise<PortfolioDashboard> {
  // Imported lazily: analysis.ts imports this module for position weights.
  const { getSecurityAnalysis } = await import("./analysis");
  const now = options.now ?? new Date();
  const portfolio = await getDefaultPortfolio();
  const base: Currency = isCurrency(portfolio.baseCurrency) ? portfolio.baseCurrency : "USD";
  const positions = (await loadPositions(portfolio.id)).filter((p) => isCurrency(p.currency));

  let providerCalls = 0;
  const budget = options.maxProviderCalls ?? 20;
  const quotes = new Map<string, QuoteView>();
  for (const p of positions) {
    const fetch = options.refreshQuotes && providerCalls < budget;
    const q = await getQuoteView(p.securityId, fetch ? { now } : { noFetch: true, now });
    providerCalls += q.attempts.length;
    quotes.set(p.id, q);
  }

  const inputs: HoldingInput[] = positions.map((p) => {
    const q = quotes.get(p.id)!;
    return {
      id: p.id,
      ticker: p.security.ticker,
      quantity: Number(p.quantity),
      averageCost: Number(p.averageCost),
      currency: p.currency as Currency,
      lastPrice: q.price,
      lastPriceCurrency: q.price === null ? null : q.currency,
      yearHigh: q.yearHigh,
    };
  });
  const summary = valueHoldings(inputs, { baseCurrency: base, fxRates: await listFxRates(), asOf: iso(now) });

  const rows: HoldingRow[] = [];
  for (const p of positions) {
    const h = summary.holdings.find((x) => x.id === p.id)!;
    const q = quotes.get(p.id)!;
    const thesis = p.thesisStrategy === "DEFENSIVE" || p.thesisStrategy === "ENTERPRISING" || p.thesisStrategy === "NET_NET" ? p.thesisStrategy : null;
    const position: PositionContext = {
      quantity: h.quantity,
      averageCost: h.averageCost,
      currency: h.currency,
      weight: h.weight,
      marketValue: h.marketValue,
      thesisStrategy: thesis,
      openedAt: p.openedAt ? iso(p.openedAt) : null,
    };
    const a = await getSecurityAnalysis(p.securityId, { quote: q, position });
    if (!a) continue;
    const isEtf = a.graham.classification.industryClass === "ETF" || p.securityType === "ETF";
    const last = a.annual[a.annual.length - 1];
    const comparable = a.valuationDashboard.price.comparable;
    const eps = last?.values.epsDiluted ?? last?.values.epsBasic;
    const equity = last?.values.stockholdersEquity;
    const shares = last?.values.sharesOutstanding;
    let etf: EtfMetrics | null = null;
    if (isEtf) {
      const since = new Date(now.getTime() - 3.2 * 365 * 86_400_000);
      const bars = await db.priceBar.findMany({ where: { securityId: p.securityId, date: { gte: since } }, orderBy: { date: "asc" }, select: { date: true, close: true, adjClose: true } });
      etf = etfMetrics({
        bars: bars.map((b) => ({ date: iso(b.date), close: Number(b.close), adjClose: b.adjClose === null ? null : Number(b.adjClose) })),
        dividends: a.dividends,
        price: q.price,
        priceDate: a.price?.date ?? null,
      });
    }
    const kf = a.decision.keyFigures;
    rows.push({
      ...h,
      securityId: p.securityId,
      name: a.security.name,
      exchangeCode: a.security.exchangeCode,
      market: a.security.market,
      securityType: p.securityType ?? a.security.assetType,
      isEtf,
      isUserEntered: p.security.source?.key === "user-entered",
      isDevFixture: a.freshness.usesDevFixtureData,
      costInputUnit: p.costInputUnit,
      openedAt: p.openedAt ? iso(p.openedAt) : null,
      notes: p.notes,
      quote: { status: q.status, timestamp: q.sourceTimestamp, timezone: q.timezone, source: q.manual?.sourceLabel ?? q.provider?.name ?? null, manual: q.manual },
      // Company valuation multiples are meaningless for funds and need a price in the statements' currency.
      pe: !isEtf && comparable !== null && eps !== undefined && eps > 0 ? comparable / eps : null,
      pb: !isEtf && comparable !== null && equity !== undefined && shares && equity > 0 ? comparable / (equity / shares) : null,
      screens: { defensive: screenSummary(a.graham.defensive), enterprising: screenSummary(a.graham.enterprising), netNet: screenSummary(a.graham.netNet.screen) },
      valuation: {
        strategy: a.decision.strategy,
        ceiling: kf.ceiling,
        marginOfSafetyTargetPrice: kf.marginOfSafetyTargetPrice,
        intrinsicValue: kf.intrinsicValue,
        marginOfSafetyPercent: kf.marginOfSafetyPercent,
        currency: kf.currency,
      },
      decision: { category: a.decision.category, strategy: a.decision.strategy },
      freshness: { quote: q.status, fundamentals: a.health.fundamentalsStatus.status, gateSufficient: a.health.gate.sufficient },
      etf,
    });
  }
  return {
    portfolio: { id: portfolio.id, name: portfolio.name, baseCurrency: base },
    summary,
    rows,
    quoteRefresh: options.refreshQuotes ? { attempted: positions.length, providerCalls, budgetReached: providerCalls >= budget } : null,
  };
}

export async function setBaseCurrency(currency: Currency) {
  const p = await getDefaultPortfolio();
  await db.portfolio.update({ where: { id: p.id }, data: { baseCurrency: currency } });
}

export async function updatePosition(positionId: string, data: { notes?: string | null; thesisStrategy?: Strategy | null }) {
  await db.position.update({ where: { id: positionId }, data });
}
