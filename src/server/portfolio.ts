import "server-only";
import { valuePortfolio } from "@/lib/portfolio";
import { db } from "./db";

export async function getDefaultPortfolio() {
  const existing = await db.portfolio.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return db.portfolio.create({ data: { name: "Main", baseCurrency: "USD" } });
}

export async function getPortfolioSummary() {
  const portfolio = await getDefaultPortfolio();
  const positions = await db.position.findMany({
    where: { portfolioId: portfolio.id },
    include: { security: { include: { exchange: true, priceBars: { orderBy: { date: "desc" }, take: 1, include: { source: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const summary = valuePortfolio(
    portfolio.baseCurrency,
    positions.map((p) => {
      const bar = p.security.priceBars[0];
      const sameCurrency = bar && bar.currency === p.currency;
      return {
        id: p.id,
        ticker: p.security.ticker,
        quantity: Number(p.quantity),
        averageCost: Number(p.averageCost),
        currency: p.currency,
        lastPrice: sameCurrency ? Number(bar.close) : null,
        lastPriceDate: sameCurrency ? bar.date.toISOString().slice(0, 10) : null,
      };
    }),
  );
  const meta = new Map(
    positions.map((p) => [
      p.id,
      {
        securityId: p.securityId,
        name: p.security.name,
        exchangeCode: p.security.exchange.code,
        isDevFixture: p.security.priceBars[0]?.source.isDevFixture ?? false,
      },
    ]),
  );
  return { portfolio, summary, meta };
}
