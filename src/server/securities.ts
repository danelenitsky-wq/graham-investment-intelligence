import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

export interface SearchResult {
  id: string;
  ticker: string;
  name: string;
  nameHe: string | null;
  exchangeCode: string;
  market: string;
  isDevFixture: boolean;
  hasData: boolean;
}

/** Search the locally stored security master by ticker, company name and exchange. */
export async function searchSecurities(query: string, options: { exchange?: string; limit?: number } = {}): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(options.limit ?? 20, 50);
  const digits = q.replace(/\D/g, "");
  const or: Prisma.SecurityWhereInput[] = [
    { ticker: { startsWith: q.toUpperCase() } },
    { name: { contains: q, mode: "insensitive" } },
    { nameHe: { contains: q, mode: "insensitive" } },
  ];
  if (digits.length >= 4 && digits === q) or.push({ cik: { endsWith: digits } });
  const rows = await db.security.findMany({
    where: {
      isActive: true,
      ...(options.exchange ? { exchange: { code: options.exchange.toUpperCase() } } : {}),
      OR: or,
    },
    include: { exchange: true, source: true, _count: { select: { priceBars: true, statements: true } } },
    take: 200,
  });
  const up = q.toUpperCase();
  const rank = (r: (typeof rows)[number]) =>
    r.ticker === up ? 0 : r.ticker.startsWith(up) ? 1 + r.ticker.length / 100 : r.name.toUpperCase().startsWith(up) ? 2 : 3;
  return rows
    .sort((a, b) => rank(a) - rank(b) || a.ticker.localeCompare(b.ticker))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      ticker: r.ticker,
      name: r.name,
      nameHe: r.nameHe,
      exchangeCode: r.exchange.code,
      market: r.exchange.market,
      isDevFixture: r.source?.isDevFixture ?? false,
      hasData: r._count.priceBars + r._count.statements > 0,
    }));
}

export async function listExchanges() {
  return db.exchange.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { securities: true } } } });
}

export async function universeSize() {
  return db.security.count();
}
