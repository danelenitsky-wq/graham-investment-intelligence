import "server-only";
import { screenDistributions } from "@/lib/graham/dividends";
import { fundamentalsFreshness } from "@/lib/freshness";
import { fundamentalsStatus, metricStatus, type DataStatus } from "@/lib/freshness/status";
import { CONCEPTS, type CanonicalConcept } from "@/lib/normalization/concepts";
import { filingUrl } from "@/lib/providers/sec-edgar/parse";
import { db } from "./db";
import { getQuoteView } from "./quotes";
import { getSettings } from "./settings";

/**
 * Every stored figure with its full provenance:
 * provider · source document/URL · reporting period · filing/publication date ·
 * retrieval timestamp · currency · unit · verification status · data status.
 * The retrieval timestamp (when we called the API) is kept apart from the
 * reporting period and filing date (how recent the information itself is).
 */
export interface MetricRecord {
  metric: string;
  value: number;
  unit: string;
  currency: string | null;
  provider: { key: string; name: string };
  sourceUrl: string | null;
  sourceConcept: string | null;
  periodType: "ANNUAL" | "QUARTERLY" | "INSTANT" | "DAILY" | "EVENT";
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  form: string | null;
  accessionNumber: string | null;
  /** Filing date (SEC) or publication/session date (prices, dividends). */
  publishedAt: string | null;
  retrievedAt: string | null;
  verificationStatus: string;
  status: DataStatus;
  /** Set when the figure is excluded from calculations, e.g. a provider "dividend" that is really a share distribution. */
  note?: "EXCLUDED_NON_CASH_DISTRIBUTION";
}

export interface Coverage {
  annualYears: { count: number; first: number | null; last: number | null };
  quarterlyPeriods: { count: number; first: string | null; last: string | null };
  dailyPrices: { count: number; first: string | null; last: string | null; years: number };
  dividends: { count: number; first: string | null; last: string | null; calendarYears: number; verified: number };
  /** Required concepts that are absent for each of the last 10 fiscal years. */
  gaps: { fiscalYear: number; missing: CanonicalConcept[] }[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const COVERAGE_CONCEPTS: CanonicalConcept[] = [
  "revenue",
  "netIncome",
  "epsDiluted",
  "currentAssets",
  "currentLiabilities",
  "longTermDebt",
  "totalLiabilities",
  "stockholdersEquity",
  "sharesOutstanding",
  "operatingCashFlow",
];

export async function getMetricProvenance(securityId: string, options: { fetchQuote?: boolean } = {}) {
  const security = await db.security.findUniqueOrThrow({ where: { id: securityId }, include: { exchange: true } });
  const settings = await getSettings();
  const [statements, bars, barCount, firstBar, actions, lastStatementsFetch, openConflicts, quote] = await Promise.all([
    db.financialStatement.findMany({
      where: { securityId, source: { isDevFixture: false } },
      include: { lineItems: true, source: true, fetch: true },
      orderBy: { periodEnd: "asc" },
    }),
    db.priceBar.findMany({ where: { securityId }, orderBy: { date: "desc" }, take: 1, include: { source: true, fetch: true } }),
    db.priceBar.count({ where: { securityId } }),
    db.priceBar.findFirst({ where: { securityId }, orderBy: { date: "asc" } }),
    db.corporateAction.findMany({ where: { securityId }, orderBy: { exDate: "asc" }, include: { source: true, fetch: true } }),
    db.dataFetch.findFirst({ where: { securityId, dataset: "annual-financials" }, orderBy: { startedAt: "desc" } }),
    db.dataVerification.count({ where: { securityId, dataset: "financials", status: "CONFLICT", resolvedAt: null } }),
    getQuoteView(securityId, { noFetch: !options.fetchQuote }),
  ]);

  const annual = statements.filter((s) => s.periodType === "ANNUAL");
  const quarterly = statements.filter((s) => s.periodType === "QUARTERLY");
  const latestAnnualEnd = annual.at(-1)?.periodEnd ?? null;
  const maxFiledAt = statements.reduce<string | null>((m, s) => (s.filedAt && (!m || iso(s.filedAt)! > m) ? iso(s.filedAt) : m), null);
  const latestFilingDate = iso(security.latestFilingDate);
  const newerFiling = Boolean(
    security.latestFilingAccession && latestFilingDate && security.latestFilingForm && !security.latestFilingForm.endsWith("/A") && (!maxFiledAt || latestFilingDate > maxFiledAt),
  );
  const fStatus = fundamentalsStatus({
    freshness: fundamentalsFreshness(iso(latestAnnualEnd), iso(new Date())!, false, settings.freshness),
    newerFiling,
    lastRefreshFailed: lastStatementsFetch?.status === "FAILED",
    conflicted: openConflicts > 0,
  });

  const records: MetricRecord[] = [];
  for (const st of statements) {
    for (const li of st.lineItems) {
      const concept = CONCEPTS[li.concept as CanonicalConcept];
      records.push({
        metric: li.concept,
        value: Number(li.value),
        unit: li.unit,
        currency: li.unit === "shares" ? null : st.currency,
        provider: { key: st.source.key, name: st.source.name },
        sourceUrl: li.sourceUrl ?? (security.cik && li.accessionNumber ? filingUrl(security.cik, li.accessionNumber) : null),
        sourceConcept: li.sourceConcept,
        periodType: concept?.instant ? "INSTANT" : st.periodType === "ANNUAL" ? "ANNUAL" : "QUARTERLY",
        fiscalYear: st.fiscalYear,
        fiscalPeriod: st.fiscalPeriod,
        periodStart: concept?.instant ? null : iso(st.periodStart),
        periodEnd: iso(st.periodEnd),
        form: st.form,
        accessionNumber: li.accessionNumber ?? st.accessionNumber,
        publishedAt: iso(li.filedAt ?? st.filedAt),
        retrievedAt: (li.retrievedAt ?? st.fetch?.completedAt ?? null)?.toISOString() ?? null,
        verificationStatus: li.verificationStatus,
        status: metricStatus(fStatus.status, li.verificationStatus),
      });
    }
  }

  const lastBar = bars[0];
  if (lastBar) {
    records.push({
      metric: "close",
      value: Number(lastBar.close),
      unit: `${lastBar.currency}/share`,
      currency: lastBar.currency,
      provider: { key: lastBar.source.key, name: lastBar.source.name },
      sourceUrl: lastBar.fetch?.endpoint ?? null,
      sourceConcept: "close",
      periodType: "DAILY",
      fiscalYear: null,
      fiscalPeriod: null,
      periodStart: null,
      periodEnd: iso(lastBar.date),
      form: null,
      accessionNumber: null,
      publishedAt: iso(lastBar.date),
      retrievedAt: (lastBar.fetch?.completedAt ?? lastBar.createdAt).toISOString(),
      verificationStatus: "SINGLE_SOURCE",
      status: quote.servedFrom === "stored-eod" ? quote.status : "LAST_CLOSE",
    });
  }

  const dividends = actions.filter((a) => a.type === "CASH_DIVIDEND");
  // Same screen as the Graham dividend rules (e.g. GOOGL 2014-04-02: Tiingo reports the Class C
  // share distribution as a $567.97 cash dividend). Closes are only needed around large amounts.
  const excludedDates = new Set<string>();
  if (dividends.length) {
    const closes = (await db.priceBar.findMany({ where: { securityId }, select: { date: true, close: true }, orderBy: { date: "asc" } })).map((b) => ({ date: iso(b.date)!, close: Number(b.close) }));
    const screened = screenDistributions(
      dividends.filter((d) => d.amount !== null).map((d) => ({ exDate: iso(d.exDate)!, amount: Number(d.amount) })),
      closes,
    );
    for (const e of screened.excluded) excludedDates.add(e.exDate);
  }
  for (const d of dividends) {
    records.push({
      metric: "dividendPerShare",
      value: Number(d.amount),
      unit: `${d.currency ?? "USD"}/share`,
      currency: d.currency,
      provider: { key: d.source.key, name: d.source.name },
      sourceUrl: d.fetch?.endpoint ?? null,
      sourceConcept: "divCash",
      periodType: "EVENT",
      fiscalYear: null,
      fiscalPeriod: null,
      periodStart: null,
      periodEnd: iso(d.exDate),
      form: null,
      accessionNumber: null,
      publishedAt: iso(d.exDate),
      retrievedAt: (d.fetch?.completedAt ?? d.createdAt).toISOString(),
      verificationStatus: d.verificationStatus,
      status: d.source.isDevFixture ? "UNAVAILABLE" : "LAST_CLOSE",
      ...(excludedDates.has(iso(d.exDate)!) ? { note: "EXCLUDED_NON_CASH_DISTRIBUTION" as const } : {}),
    });
  }

  const byYear = new Map<number, Set<string>>();
  for (const st of annual) {
    const set = byYear.get(st.fiscalYear) ?? new Set<string>();
    for (const li of st.lineItems) set.add(li.concept);
    byYear.set(st.fiscalYear, set);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const divYears = new Set(dividends.filter((d) => !excludedDates.has(iso(d.exDate)!)).map((d) => d.exDate.getUTCFullYear()));
  const coverage: Coverage = {
    annualYears: { count: years.length, first: years[0] ?? null, last: years.at(-1) ?? null },
    quarterlyPeriods: { count: new Set(quarterly.map((q) => iso(q.periodEnd))).size, first: iso(quarterly[0]?.periodEnd), last: iso(quarterly.at(-1)?.periodEnd) },
    dailyPrices: {
      count: barCount,
      first: iso(firstBar?.date),
      last: iso(lastBar?.date),
      years: firstBar && lastBar ? Math.round(((lastBar.date.getTime() - firstBar.date.getTime()) / (365.25 * 86_400_000)) * 10) / 10 : 0,
    },
    dividends: {
      count: dividends.length,
      first: iso(dividends[0]?.exDate),
      last: iso(dividends.at(-1)?.exDate),
      calendarYears: divYears.size,
      verified: dividends.filter((d) => d.verificationStatus === "VERIFIED").length,
    },
    gaps: years
      .slice(-10)
      .map((fy) => ({ fiscalYear: fy, missing: COVERAGE_CONCEPTS.filter((c) => !byYear.get(fy)!.has(c)) }))
      .filter((g) => g.missing.length > 0),
  };

  return {
    security: { id: security.id, ticker: security.ticker, exchange: security.exchange.code, cik: security.cik },
    fundamentalsStatus: fStatus,
    latestFiling: security.latestFilingAccession
      ? {
          form: security.latestFilingForm,
          filedAt: latestFilingDate,
          acceptedAt: security.latestFilingAcceptedAt?.toISOString() ?? null,
          accessionNumber: security.latestFilingAccession,
          url: security.cik ? filingUrl(security.cik, security.latestFilingAccession) : null,
        }
      : null,
    quote: {
      status: quote.status,
      price: quote.price,
      currency: quote.currency,
      provider: quote.provider,
      feed: quote.feed,
      sourceTimestamp: quote.sourceTimestamp,
      retrievedAt: quote.retrievedAt,
      yearHigh: quote.yearHigh,
      yearLow: quote.yearLow,
      yearRangeDerived: quote.yearRangeDerived,
      verification: quote.verification,
    },
    coverage,
    records,
  };
}
