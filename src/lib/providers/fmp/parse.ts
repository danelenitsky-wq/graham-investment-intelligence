/**
 * Pure parsers for Financial Modeling Prep "stable" API responses
 * (https://site.financialmodelingprep.com/developer/docs/stable).
 *
 * Schemas are deliberately tolerant (unknown fields pass through, numbers may
 * be null) but every field we rely on is validated; a response missing the
 * price or timestamp is rejected rather than guessed.
 */
import { z } from "zod";
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import type { NormalizedDividend, NormalizedSplit } from "@/lib/normalization/market";
import type { QuoteFeed } from "@/lib/freshness/quote";
import type { SourcedPeriod } from "@/lib/verification";
import type { NormalizedQuote } from "../types";

const num = z.number().nullable().optional();

export const fmpQuoteSchema = z.array(
  z.looseObject({
    symbol: z.string(),
    name: z.string().nullable().optional(),
    price: z.number(),
    changePercentage: num,
    change: num,
    volume: num,
    dayLow: num,
    dayHigh: num,
    yearHigh: num,
    yearLow: num,
    marketCap: num,
    exchange: z.string().nullable().optional(),
    open: num,
    previousClose: num,
    /** Unix seconds of the last trade/quote. */
    timestamp: z.number(),
  }),
);

export const fmpProfileSchema = z.array(
  z.looseObject({
    symbol: z.string(),
    currency: z.string().nullable().optional(),
    exchange: z.string().nullable().optional(),
    exchangeFullName: z.string().nullable().optional(),
    marketCap: num,
    cik: z.string().nullable().optional(),
    isin: z.string().nullable().optional(),
  }),
);

export function parseFmpQuote(
  rows: z.infer<typeof fmpQuoteSchema>,
  ctx: { currency: string; feed: QuoteFeed; delayMinutes: number | null },
): NormalizedQuote | null {
  const r = rows[0];
  if (!r || !(r.price > 0) || !(r.timestamp > 0)) return null;
  const prev = r.previousClose ?? null;
  const change = r.change ?? (prev ? r.price - prev : null);
  return {
    symbol: r.symbol,
    price: r.price,
    previousClose: prev,
    change,
    // FMP reports changePercentage in percent units (1.23 = +1.23%).
    changePercent: r.changePercentage != null ? r.changePercentage / 100 : prev ? r.price / prev - 1 : null,
    open: r.open ?? null,
    dayHigh: r.dayHigh ?? null,
    dayLow: r.dayLow ?? null,
    volume: r.volume ?? null,
    marketCap: r.marketCap ?? null,
    yearHigh: r.yearHigh ?? null,
    yearLow: r.yearLow ?? null,
    currency: ctx.currency,
    exchange: r.exchange ?? null,
    sourceTimestamp: new Date(r.timestamp * 1000).toISOString(),
    feed: ctx.feed,
    delayMinutes: ctx.delayMinutes,
    feedNote: null,
  };
}

// ───────────────────────────── Statements ─────────────────────────────

const statementBase = {
  date: z.string(), // period end
  symbol: z.string().optional(),
  reportedCurrency: z.string().nullable().optional(),
  cik: z.string().nullable().optional(),
  filingDate: z.string().nullable().optional(),
  acceptedDate: z.string().nullable().optional(),
  fiscalYear: z.union([z.string(), z.number()]).nullable().optional(),
  period: z.string().nullable().optional(), // FY, Q1..Q4
};

export const fmpStatementSchema = z.array(z.looseObject(statementBase));
export type FmpStatementRow = z.infer<typeof fmpStatementSchema>[number];

/** FMP field → canonical concept. First present field wins. */
export const FMP_FIELD_MAP: Partial<Record<CanonicalConcept, string[]>> = {
  revenue: ["revenue"],
  operatingIncome: ["operatingIncome"],
  pretaxIncome: ["incomeBeforeTax"],
  interestExpense: ["interestExpense"],
  netIncome: ["netIncome"],
  epsBasic: ["eps"],
  epsDiluted: ["epsDiluted", "epsdiluted"],
  dilutedShares: ["weightedAverageShsOutDil"],
  totalAssets: ["totalAssets"],
  currentAssets: ["totalCurrentAssets"],
  cashAndEquivalents: ["cashAndCashEquivalents"],
  goodwill: ["goodwill"],
  currentLiabilities: ["totalCurrentLiabilities"],
  totalLiabilities: ["totalLiabilities"],
  longTermDebt: ["longTermDebt"],
  stockholdersEquity: ["totalStockholdersEquity"],
  totalEquityInclNci: ["totalEquity"],
  operatingCashFlow: ["operatingCashFlow", "netCashProvidedByOperatingActivities"],
  capitalExpenditures: ["capitalExpenditure"],
  dividendsPaid: ["commonDividendsPaid", "dividendsPaid", "netDividendsPaid"],
  depreciationAmortization: ["depreciationAndAmortization"],
};

/**
 * Merge income / balance / cash-flow rows (joined on period end) into sourced
 * periods. Zero-valued placeholders are kept only when the vendor reports them;
 * absent fields stay absent.
 */
export function mergeFmpStatements(...statements: FmpStatementRow[][]): { periods: SourcedPeriod[]; currency: string | null } {
  const byEnd = new Map<string, SourcedPeriod & { filedAt: string | null }>();
  let currency: string | null = null;
  for (const rows of statements) {
    for (const row of rows) {
      const end = row.date.slice(0, 10);
      currency ??= row.reportedCurrency ?? null;
      const fy = Number(row.fiscalYear ?? end.slice(0, 4));
      const p =
        byEnd.get(end) ??
        ({ periodEnd: end, fiscalYear: fy, fiscalPeriod: (row.period ?? "FY").toUpperCase(), values: {}, reference: null, filedAt: row.filingDate ?? null } as SourcedPeriod & { filedAt: string | null });
      for (const [concept, fields] of Object.entries(FMP_FIELD_MAP) as [CanonicalConcept, string[]][]) {
        if (p.values[concept] !== undefined) continue;
        for (const f of fields) {
          const v = (row as Record<string, unknown>)[f];
          if (typeof v === "number" && Number.isFinite(v)) {
            p.values[concept] = v;
            break;
          }
        }
      }
      p.reference = `FMP ${p.fiscalPeriod} ${end}${row.filingDate ? ` (filed ${row.filingDate.slice(0, 10)})` : ""}`;
      byEnd.set(end, p);
    }
  }
  const periods = [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).map(({ filedAt: _f, ...rest }) => {
    void _f;
    return rest;
  });
  return { periods, currency };
}

// ─────────────────────────── Corporate actions ───────────────────────────

export const fmpDividendsSchema = z.array(
  z.looseObject({
    date: z.string(), // ex-dividend date
    paymentDate: z.string().nullable().optional(),
    dividend: num,
    adjDividend: num,
  }),
);

export const fmpSplitsSchema = z.array(z.looseObject({ date: z.string(), numerator: z.number(), denominator: z.number() }));

export const fmpEodSchema = z.array(
  z.looseObject({ date: z.string(), open: num, high: num, low: num, close: z.number(), volume: num }),
);
export const fmpAdjEodSchema = z.array(z.looseObject({ date: z.string(), adjClose: num }));

export function parseFmpDividends(rows: z.infer<typeof fmpDividendsSchema>, currency: string): NormalizedDividend[] {
  return rows
    .filter((r) => (r.dividend ?? 0) > 0)
    .map((r) => ({ exDate: r.date.slice(0, 10), amount: r.dividend!, currency }))
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
}

export function parseFmpSplits(rows: z.infer<typeof fmpSplitsSchema>): NormalizedSplit[] {
  return rows
    .filter((r) => r.numerator > 0 && r.denominator > 0 && r.numerator !== r.denominator)
    .map((r) => ({ exDate: r.date.slice(0, 10), ratio: r.numerator / r.denominator }))
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
}
