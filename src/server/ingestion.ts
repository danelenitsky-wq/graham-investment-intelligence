import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { CONCEPTS, type CanonicalConcept } from "@/lib/normalization/concepts";
import type { NormalizedAnnualPeriod, SplitEvent } from "@/lib/normalization/statements";
import { normalizeCompanyFacts } from "@/lib/normalization/statements";
import { DEV_EXCHANGE, DEV_FIXTURE, FIXTURE_COMPANIES, fixtureCompanyFacts, fixturePriceHistory } from "@/lib/providers/dev-fixture";
import { SEC_EDGAR } from "@/lib/providers/sec-edgar";
import { FMP } from "@/lib/providers/fmp";
import { TIINGO } from "@/lib/providers/tiingo";
import { TASE } from "@/lib/providers/tase";
import { fundamentalsProviderFor, priceProviderFor, referenceProvider } from "@/lib/providers/registry";
import { ProviderError, type FetchMeta, type MarketCode, type ProviderDescriptor } from "@/lib/providers/types";
import type { NormalizedDividend, NormalizedPriceBar, NormalizedSplit } from "@/lib/normalization/market";
import { db } from "./db";
import { env } from "./env";
import { getSettings } from "./settings";
import { saveAnalysisSnapshots } from "./analysis";
import { verifyFundamentals } from "./verification";

export const EXCHANGES = [
  { code: "NASDAQ", mic: "XNAS", name: "Nasdaq", nameHe: "נאסד\"ק", market: "US", country: "US", currency: "USD", timezone: "America/New_York" },
  { code: "NYSE", mic: "XNYS", name: "New York Stock Exchange", nameHe: "הבורסה של ניו יורק", market: "US", country: "US", currency: "USD", timezone: "America/New_York" },
  { code: "NYSEAMERICAN", mic: "XASE", name: "NYSE American", nameHe: "NYSE American", market: "US", country: "US", currency: "USD", timezone: "America/New_York" },
  { code: "NYSEARCA", mic: "ARCX", name: "NYSE Arca", nameHe: "NYSE Arca", market: "US", country: "US", currency: "USD", timezone: "America/New_York" },
  { code: "CBOE", mic: "BATS", name: "Cboe BZX", nameHe: "Cboe BZX", market: "US", country: "US", currency: "USD", timezone: "America/Chicago" },
  { code: "OTC", mic: "OTCM", name: "OTC Markets", nameHe: "OTC Markets", market: "US", country: "US", currency: "USD", timezone: "America/New_York" },
  { code: "TASE", mic: "XTAE", name: "Tel Aviv Stock Exchange", nameHe: "הבורסה לניירות ערך בתל אביב", market: "IL", country: "IL", currency: "ILS", timezone: "Asia/Jerusalem" },
] as const;

export async function ensureReferenceData() {
  for (const e of EXCHANGES) {
    await db.exchange.upsert({ where: { code: e.code }, create: { ...e }, update: { name: e.name, nameHe: e.nameHe } });
  }
  for (const d of [SEC_EDGAR, FMP, TIINGO, TASE]) await ensureSource(d);
}

const KIND: Record<string, "REFERENCE" | "FUNDAMENTALS" | "PRICES"> = {
  REFERENCE: "REFERENCE",
  FUNDAMENTALS: "FUNDAMENTALS",
  PRICES: "PRICES",
  QUOTES: "PRICES",
  FILINGS: "FUNDAMENTALS",
  VERIFICATION: "FUNDAMENTALS",
};

export async function ensureSource(d: ProviderDescriptor) {
  return db.dataSource.upsert({
    where: { key: d.key },
    create: {
      key: d.key,
      name: d.name,
      kind: KIND[d.capabilities[0]],
      baseUrl: d.baseUrl,
      termsUrl: d.termsUrl,
      isDevFixture: d.isDevFixture,
    },
    update: { name: d.name, baseUrl: d.baseUrl, termsUrl: d.termsUrl, isDevFixture: d.isDevFixture },
  });
}

export async function startFetch(sourceId: string, dataset: string, endpoint: string, securityId?: string) {
  return db.dataFetch.create({ data: { sourceId, dataset, endpoint, securityId } });
}

export async function finishFetch(id: string, data: Partial<Prisma.DataFetchUncheckedUpdateInput>) {
  return db.dataFetch.update({ where: { id }, data: { completedAt: new Date(), ...data } });
}

export async function failFetch(id: string, e: unknown) {
  const err = e instanceof ProviderError ? e : null;
  await finishFetch(id, {
    status: "FAILED",
    httpStatus: err?.httpStatus ?? null,
    endpoint: err?.endpoint ?? undefined,
    errorMessage: e instanceof Error ? e.message.slice(0, 1000) : String(e).slice(0, 1000),
  });
}

// ─────────────────────────────── Universe ───────────────────────────────

export async function syncUniverse(): Promise<{ upserted: number }> {
  await ensureReferenceData();
  const provider = referenceProvider();
  const source = await ensureSource(provider.descriptor);
  const fetch = await startFetch(source.id, "ticker-universe", "https://www.sec.gov/files/company_tickers_exchange.json");
  try {
    const { entries, meta } = await provider.listUniverse();
    const exchanges = new Map((await db.exchange.findMany()).map((e) => [e.code, e.id]));
    let upserted = 0;
    // Batched upserts keep memory and transaction size bounded (~10k rows).
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      await db.$transaction(
        chunk
          .filter((e) => exchanges.has(e.exchangeCode))
          .map((e) =>
            db.security.upsert({
              where: { ticker_exchangeId: { ticker: e.ticker, exchangeId: exchanges.get(e.exchangeCode)! } },
              create: { ticker: e.ticker, name: e.name, cik: e.cik, exchangeId: exchanges.get(e.exchangeCode)!, sourceId: source.id, reportingCurrency: "USD" },
              update: { name: e.name, cik: e.cik, isActive: true },
            }),
          ),
      );
      upserted += chunk.length;
    }
    await finishFetch(fetch.id, { status: "SUCCESS", httpStatus: meta.httpStatus, payloadHash: meta.payloadHash, recordCount: upserted });
    return { upserted };
  } catch (e) {
    await failFetch(fetch.id, e);
    throw e;
  }
}

// ──────────────────────────── Persistence helpers ────────────────────────────

const STATEMENT_TYPES = ["INCOME", "BALANCE_SHEET", "CASH_FLOW"] as const;

async function persistPeriods(
  securityId: string,
  sourceId: string,
  fetchId: string,
  periods: NormalizedAnnualPeriod[],
  periodType: "ANNUAL" | "QUARTERLY" = "ANNUAL",
) {
  for (const p of periods) {
    for (const st of STATEMENT_TYPES) {
      const items = (Object.entries(p.values) as [CanonicalConcept, NonNullable<NormalizedAnnualPeriod["values"][CanonicalConcept]>][]).filter(
        ([concept]) => CONCEPTS[concept].statement === st,
      );
      if (items.length === 0) continue;
      const latestFiling = items.reduce((a, [, v]) => (v.filedAt > a.filedAt ? v : a), items[0][1]);
      const periodEnd = new Date(p.periodEnd + "T00:00:00Z");
      const data = {
        fiscalYear: p.fiscalYear,
        fiscalPeriod: p.fiscalPeriod ?? "FY",
        periodStart: st === "BALANCE_SHEET" || !p.periodStart ? null : new Date(p.periodStart + "T00:00:00Z"),
        currency: p.currency,
        form: latestFiling.form,
        accessionNumber: latestFiling.accessionNumber,
        filedAt: new Date(latestFiling.filedAt + "T00:00:00Z"),
        isRestated: items.some(([, v]) => v.restated),
        fetchId,
      };
      await db.$transaction(async (tx) => {
        const stmt = await tx.financialStatement.upsert({
          where: {
            securityId_statementType_periodType_periodEnd_sourceId: { securityId, statementType: st, periodType, periodEnd, sourceId },
          },
          create: { securityId, sourceId, statementType: st, periodType, periodEnd, ...data },
          update: data,
        });
        await tx.financialLineItem.deleteMany({ where: { statementId: stmt.id } });
        await tx.financialLineItem.createMany({
          data: items.map(([concept, v]) => ({
            statementId: stmt.id,
            concept,
            sourceConcept: v.sourceConcept,
            value: v.value,
            unit: v.unit,
            accessionNumber: v.accessionNumber,
            filedAt: new Date(v.filedAt + "T00:00:00Z"),
            splitAdjusted: v.splitAdjusted,
          })),
        });
      });
    }
  }
}

async function persistPrices(securityId: string, sourceId: string, fetchId: string, bars: NormalizedPriceBar[]) {
  for (let i = 0; i < bars.length; i += 1000) {
    const chunk = bars.slice(i, i + 1000);
    await db.$transaction([
      db.priceBar.deleteMany({
        where: { securityId, sourceId, date: { in: chunk.map((b) => new Date(b.date + "T00:00:00Z")) } },
      }),
      db.priceBar.createMany({
        data: chunk.map((b) => ({
          securityId,
          sourceId,
          fetchId,
          date: new Date(b.date + "T00:00:00Z"),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          adjClose: b.adjClose,
          volume: b.volume === null ? null : BigInt(Math.round(b.volume)),
          currency: b.currency,
        })),
      }),
    ]);
  }
}

async function persistCorporateActions(
  securityId: string,
  sourceId: string,
  fetchId: string,
  dividends: NormalizedDividend[],
  splits: NormalizedSplit[],
) {
  const rows = [
    ...dividends.map((d) => ({ type: "CASH_DIVIDEND" as const, exDate: d.exDate, amount: d.amount, ratio: null, currency: d.currency })),
    ...splits.map((s) => ({ type: "STOCK_SPLIT" as const, exDate: s.exDate, amount: null, ratio: s.ratio, currency: null })),
  ];
  for (const r of rows) {
    const exDate = new Date(r.exDate + "T00:00:00Z");
    await db.corporateAction.upsert({
      where: { securityId_type_exDate_sourceId: { securityId, type: r.type, exDate, sourceId } },
      create: { securityId, sourceId, fetchId, type: r.type, exDate, amount: r.amount, ratio: r.ratio, currency: r.currency },
      update: { amount: r.amount, ratio: r.ratio, fetchId },
    });
  }
}

async function recordNormalizationWarnings(securityId: string, sourceId: string, warnings: { code: string; message: string; context?: unknown }[]) {
  await db.dataQualityIssue.updateMany({ where: { securityId, sourceId, resolvedAt: null }, data: { resolvedAt: new Date() } });
  if (warnings.length === 0) return;
  await db.dataQualityIssue.createMany({
    data: warnings.map((w) => ({
      securityId,
      sourceId,
      severity: w.code === "NO_ANNUAL_DATA" || w.code === "UNSUPPORTED_TAXONOMY" ? ("ERROR" as const) : ("WARNING" as const),
      code: w.code,
      message: w.message,
      context: (w.context ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
}

// ──────────────────────────────── Refresh ────────────────────────────────

export type DatasetOutcome = { status: "SUCCESS" | "UNCHANGED" | "FAILED" | "SKIPPED"; count?: number; error?: string; code?: string };

export interface RefreshOutcome {
  prices: DatasetOutcome & { count?: number };
  fundamentals: DatasetOutcome & { periods?: number; quarters?: number };
  verification?: { status: "SUCCESS" | "FAILED" | "SKIPPED"; conflicts?: number; compared?: number; error?: string; code?: string };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function securityContext(securityId: string) {
  const security = await db.security.findUniqueOrThrow({ where: { id: securityId }, include: { exchange: true } });
  const market = security.exchange.market as MarketCode;
  const ref = { ticker: security.ticker, exchangeCode: security.exchange.code, cik: security.cik, taseSecurityNumber: security.taseSecurityNumber };
  return { security, market, ref };
}

async function lastSuccessfulHash(securityId: string, sourceId: string, dataset: string) {
  const f = await db.dataFetch.findFirst({
    where: { securityId, sourceId, dataset, status: { in: ["SUCCESS", "PARTIAL"] }, payloadHash: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  return f?.payloadHash ?? null;
}

/** Daily price history, dividends and splits. */
export async function refreshPrices(securityId: string): Promise<{ outcome: RefreshOutcome["prices"]; splits?: SplitEvent[] }> {
  const { market, ref } = await securityContext(securityId);
  const settings = await getSettings();
  const priceProvider = priceProviderFor(market);
  const priceSource = await ensureSource(priceProvider.descriptor);
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear() - settings.priceHistoryYears, 0, 1));
  const pf = await startFetch(priceSource.id, "daily-prices", priceProvider.descriptor.baseUrl, securityId);
  try {
    const hist = await priceProvider.getDailyHistory(ref, { start: isoDate(start), end: isoDate(end) });
    await persistPrices(securityId, priceSource.id, pf.id, hist.bars);
    await persistCorporateActions(securityId, priceSource.id, pf.id, hist.dividends, hist.splits);
    await finishFetch(pf.id, {
      status: hist.rejected.length ? "PARTIAL" : "SUCCESS",
      endpoint: hist.meta.endpoint,
      httpStatus: hist.meta.httpStatus,
      payloadHash: hist.meta.payloadHash,
      recordCount: hist.bars.length,
      errorMessage: hist.rejected.length ? `${hist.rejected.length} bars rejected by validation` : null,
    });
    return { outcome: { status: "SUCCESS", count: hist.bars.length }, splits: hist.splits };
  } catch (e) {
    await failFetch(pf.id, e);
    // Fall back to split history already stored (if any).
    const stored = await db.corporateAction.findMany({ where: { securityId, type: "STOCK_SPLIT" } });
    return {
      outcome: { status: "FAILED", error: e instanceof Error ? e.message : String(e), code: e instanceof ProviderError ? e.code : undefined },
      splits: stored.length ? stored.map((s) => ({ exDate: isoDate(s.exDate), ratio: Number(s.ratio) })) : undefined,
    };
  }
}

/**
 * Annual + quarterly statements from the primary filings source. When the raw
 * payload is byte-identical to the last successful one, nothing is rewritten
 * (outcome UNCHANGED) and calculations are not re-run.
 */
export async function refreshFundamentals(securityId: string, splits?: SplitEvent[]): Promise<RefreshOutcome["fundamentals"]> {
  const { market, ref } = await securityContext(securityId);
  if (!splits) {
    const stored = await db.corporateAction.findMany({ where: { securityId, type: "STOCK_SPLIT" } });
    if (stored.length) splits = stored.map((s) => ({ exDate: isoDate(s.exDate), ratio: Number(s.ratio) }));
  }
  const fundamentalsProvider = fundamentalsProviderFor(market);
  const fSource = await ensureSource(fundamentalsProvider.descriptor);
  const previousHash = await lastSuccessfulHash(securityId, fSource.id, "annual-financials");
  const ff = await startFetch(fSource.id, "annual-financials", fundamentalsProvider.descriptor.baseUrl, securityId);
  try {
    const { result, quarterly, meta } = await fundamentalsProvider.getAnnualFinancials(ref, { splits });
    // The split list is part of the input: a new split changes per-share values even when the filing payload did not change.
    const inputHash = meta.payloadHash ? `${meta.payloadHash}|splits:${JSON.stringify(splits ?? [])}` : null;
    const unchanged = inputHash !== null && inputHash === previousHash;
    if (!unchanged) {
      await persistPeriods(securityId, fSource.id, ff.id, result.periods, "ANNUAL");
      if (quarterly) await persistPeriods(securityId, fSource.id, ff.id, quarterly.periods, "QUARTERLY");
      await recordNormalizationWarnings(securityId, fSource.id, result.warnings);
      if (result.currency) await db.security.update({ where: { id: securityId }, data: { reportingCurrency: result.currency } });
    }
    await finishFetch(ff.id, {
      status: "SUCCESS",
      endpoint: meta.endpoint,
      httpStatus: meta.httpStatus,
      payloadHash: inputHash,
      recordCount: result.periods.length + (quarterly?.periods.length ?? 0),
      errorMessage: unchanged ? "Unchanged since last retrieval" : null,
    });
    return { status: unchanged ? "UNCHANGED" : "SUCCESS", periods: result.periods.length, quarters: quarterly?.periods.length ?? 0 };
  } catch (e) {
    await failFetch(ff.id, e);
    return { status: "FAILED", error: e instanceof Error ? e.message : String(e), code: e instanceof ProviderError ? e.code : undefined };
  }
}

/** Fetch prices + fundamentals for one security from its market's providers and store them with provenance. */
export async function refreshSecurity(securityId: string): Promise<RefreshOutcome> {
  await ensureReferenceData();
  const security = await db.security.findUniqueOrThrow({ where: { id: securityId }, include: { exchange: true } });
  if (security.exchange.code === DEV_EXCHANGE.code) {
    return refreshFixtureSecurity(securityId);
  }
  // Prices first: split history is needed to make per-share fundamentals comparable.
  const prices = await refreshPrices(securityId);
  const fundamentals = await refreshFundamentals(securityId, prices.splits);
  const outcome: RefreshOutcome = { prices: prices.outcome, fundamentals };
  if (fundamentals.status === "SUCCESS" || fundamentals.status === "UNCHANGED") {
    outcome.verification = await verifyFundamentals(securityId);
  }
  if (prices.outcome.status === "SUCCESS" || fundamentals.status === "SUCCESS") {
    await saveAnalysisSnapshots(securityId);
  }
  return outcome;
}

// ─────────────────────────── Development fixtures ───────────────────────────

/** Load the fictional fixture companies. Refuses to run unless ENABLE_DEV_FIXTURES=true. */
export async function loadDevFixtures(): Promise<{ securities: number }> {
  if (!env().ENABLE_DEV_FIXTURES) throw new Error("Refusing to load development fixtures: ENABLE_DEV_FIXTURES is not 'true'.");
  await ensureReferenceData();
  const source = await ensureSource(DEV_FIXTURE);
  const exchange = await db.exchange.upsert({
    where: { code: DEV_EXCHANGE.code },
    create: { ...DEV_EXCHANGE, market: "OTHER" },
    update: { name: DEV_EXCHANGE.name, nameHe: DEV_EXCHANGE.nameHe },
  });
  for (const c of FIXTURE_COMPANIES) {
    const sec = await db.security.upsert({
      where: { ticker_exchangeId: { ticker: c.ticker, exchangeId: exchange.id } },
      create: { ticker: c.ticker, name: c.name, nameHe: c.nameHe, cik: c.cik, exchangeId: exchange.id, sector: c.sector, isUtility: c.isUtility, sourceId: source.id, reportingCurrency: "USD", fiscalYearEndMonth: 12 },
      update: { name: c.name, nameHe: c.nameHe, sector: c.sector },
    });
    await refreshFixtureSecurity(sec.id);
  }
  return { securities: FIXTURE_COMPANIES.length };
}

async function refreshFixtureSecurity(securityId: string): Promise<RefreshOutcome> {
  if (!env().ENABLE_DEV_FIXTURES) {
    return {
      prices: { status: "SKIPPED", error: "ENABLE_DEV_FIXTURES is off", code: "NOT_CONFIGURED" },
      fundamentals: { status: "SKIPPED", error: "ENABLE_DEV_FIXTURES is off", code: "NOT_CONFIGURED" },
    };
  }
  const security = await db.security.findUniqueOrThrow({ where: { id: securityId } });
  const company = FIXTURE_COMPANIES.find((c) => c.ticker === security.ticker);
  if (!company) throw new Error(`No fixture for ${security.ticker}`);
  const source = await ensureSource(DEV_FIXTURE);
  const meta: FetchMeta = { endpoint: `fixture://${company.ticker}`, httpStatus: null, payloadHash: null, fetchedAt: new Date().toISOString() };

  // Fixtures are fully regenerated on each load: drop previous fixture rows first.
  await db.$transaction([
    db.financialStatement.deleteMany({ where: { securityId, sourceId: source.id } }),
    db.priceBar.deleteMany({ where: { securityId, sourceId: source.id } }),
    db.corporateAction.deleteMany({ where: { securityId, sourceId: source.id } }),
  ]);
  const today = isoDate(new Date());
  const startYear = company.years[0].fy + 1;
  const pf = await startFetch(source.id, "daily-prices", meta.endpoint, securityId);
  const { bars, dividends } = fixturePriceHistory(company, `${startYear}-01-02`, today);
  await persistPrices(securityId, source.id, pf.id, bars);
  await persistCorporateActions(securityId, source.id, pf.id, dividends, []);
  await finishFetch(pf.id, { status: "SUCCESS", recordCount: bars.length });

  const ff = await startFetch(source.id, "annual-financials", meta.endpoint, securityId);
  const result = normalizeCompanyFacts(fixtureCompanyFacts(company), { splits: [] });
  await persistPeriods(securityId, source.id, ff.id, result.periods);
  await recordNormalizationWarnings(securityId, source.id, result.warnings);
  await finishFetch(ff.id, { status: "SUCCESS", recordCount: result.periods.length });

  await saveAnalysisSnapshots(securityId);
  return { prices: { status: "SUCCESS", count: bars.length }, fundamentals: { status: "SUCCESS", periods: result.periods.length } };
}
