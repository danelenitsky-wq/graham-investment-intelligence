import "server-only";
import { fundamentalsStatus, type DataStatus, type FundamentalsReason } from "@/lib/freshness/status";
import type { Prisma } from "@/generated/prisma/client";
import { computeInterimHealth, type InterimHealth } from "@/lib/interim";
import { evaluateDecision, stableHash, type DecisionResult, type DecisionSettings, type PositionContext, type Strategy } from "@/lib/decision";
import {
  fundamentalsFreshness,
  priceFreshness,
  validateAnnualFinancials,
  type FreshnessReport,
} from "@/lib/freshness";
import { analyzeGraham, GRAHAM_ENGINE_VERSION, type GrahamAnalysis } from "@/lib/graham";
import { classifyIssuer } from "@/lib/graham/classification";
import { CPI_DEFAULT } from "@/lib/graham/registry";
import type { CpiReference, GrahamInputs, ScreenResult } from "@/lib/graham/types";
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { valueWithGraham, VALUATION_ENGINE_VERSION, type GrahamValuation, type ValueEstimate } from "@/lib/valuation/graham";
import { adjustedChartSeries } from "@/lib/normalization/market";
import { bondYieldAdjustedFormula, modernMetrics, type ModernMetrics } from "@/lib/valuation/modern";
import { buildValuationDashboard, resolvePriceContext, type ValuationDashboard } from "@/lib/valuation/engine";
import { buildFairValue, type FairValueSummary } from "@/lib/valuation/fair-value";
import { buildIntrinsicBase, computeIntrinsicValue, defaultAssumptions, type AssumptionDefaults, type IntrinsicBase, type IntrinsicResult } from "@/lib/valuation/intrinsic";
import type { AppSettings } from "@/lib/settings/schema";
import { evaluateDataSufficiency, type GateResult } from "@/lib/freshness/gate";
import { filingUrl } from "@/lib/providers/sec-edgar/parse";
import { providerStatuses } from "@/lib/providers/registry";
import { db } from "./db";
import { getQuoteView, type QuoteView } from "./quotes";
import { getSettings } from "./settings";
import { getPortfolioSummary } from "./portfolio";
import { persistDecisionSnapshot } from "./decision";

export interface SecuritySummary {
  id: string;
  ticker: string;
  name: string;
  nameHe: string | null;
  exchangeCode: string;
  exchangeName: string;
  market: "US" | "IL" | "OTHER";
  cik: string | null;
  sector: string | null;
  industry: string | null;
  isUtility: boolean;
  sicCode: string | null;
  assetType: string;
  fiscalYearEndMonth: number | null;
  reportingCurrency: string | null;
  isDevFixture: boolean;
}

export interface PeriodProvenance {
  fiscalYear: number;
  periodEnd: string;
  sourceKey: string;
  sourceName: string;
  isDevFixture: boolean;
  form: string | null;
  accessionNumber: string | null;
  filingUrl: string | null;
  filedAt: string | null;
  /** When we retrieved the statement from the provider. */
  retrievedAt: string | null;
  isRestated: boolean;
  concepts: Partial<Record<CanonicalConcept, string>>; // concept → source taxonomy tag
  units: Partial<Record<CanonicalConcept, string>>;
  verification: Partial<Record<CanonicalConcept, string>>; // concept → VerificationStatus
}

export interface QuarterRow {
  fiscalYear: number;
  fiscalPeriod: string;
  periodEnd: string;
  currency: string;
  filedAt: string | null;
  form: string | null;
  accessionNumber: string | null;
  values: Partial<Record<CanonicalConcept, number>>;
}

export interface ProviderHealth {
  key: string;
  name: string;
  configured: boolean;
  missingEnv: string[];
  capabilities: string[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  /** Failures since the last success for this security. */
  consecutiveFailures: number;
  state: "OK" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED" | "UNUSED";
}

export interface ConflictRow {
  dataset: string;
  metric: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  primarySource: string;
  primaryValue: number | null;
  primaryReference: string | null;
  secondarySource: string;
  secondaryValue: number | null;
  relDiff: number | null;
  checkedAt: string;
}

export interface DataHealth {
  gate: GateResult;
  latestQuoteTimestamp: string | null;
  latestFiling: { form: string | null; filingDate: string | null; acceptedAt: string | null; accessionNumber: string | null; url: string | null } | null;
  newerFiling: { form: string; filedAt: string; accessionNumber: string } | null;
  /** FRESH … CONFLICTED for the filings-based data, judged by reporting period, not by API retrieval time. */
  fundamentalsStatus: { status: DataStatus; reasons: FundamentalsReason[] };
  lastFilingCheckAt: string | null;
  lastSuccessfulRefreshAt: string | null;
  conflicts: ConflictRow[];
  verification: { verified: number; conflict: number; singleSource: number; unverified: number; lastCheckedAt: string | null; source: string | null };
  providers: ProviderHealth[];
}

export interface SecurityAnalysis {
  security: SecuritySummary;
  /** Price used by the engines: the latest quote (or stored close), with its freshness status. */
  price: { value: number; date: string; currency: string; sourceKey: string; isDevFixture: boolean; status: QuoteView["status"]; sourceTimestamp: string | null } | null;
  quote: QuoteView;
  health: DataHealth;
  quarterly: QuarterRow[];
  /** Latest-quarter and TTM health since the latest annual report. Separate from (and never feeding) the Graham rules. */
  interim: InterimHealth;
  priceHistory: { date: string; close: number }[];
  /** Provider of the stored daily price history. */
  priceHistorySource: string | null;
  dividends: { exDate: string; amount: number; currency: string | null }[];
  annual: AnnualFinancials[];
  provenance: PeriodProvenance[];
  defensive: ScreenResult;
  enterprising: ScreenResult;
  /** Full Graham engine output: classification, three panels, trends, excluded distributions. */
  graham: GrahamAnalysis;
  valuation: GrahamValuation;
  modern: { bondYieldAdjusted: ValueEstimate; metrics: ModernMetrics };
  /** Price ceilings, Graham Number, Net-Net threshold, compared with the price (and its basis). */
  valuationDashboard: ValuationDashboard;
  /** Optional conservative intrinsic value (MODERN EXTENSION) with its base data and default assumptions. */
  intrinsic: { base: IntrinsicBase; defaults: AssumptionDefaults; result: IntrinsicResult };
  /** Bottom-line summary: market price vs a blended fair value range from the models that fit. */
  fairValue: FairValueSummary;
  freshness: FreshnessReport;
  /** Application-defined research classification (deterministic; see src/lib/decision). */
  decision: DecisionResult;
  /** The position held in the portfolio, when the stock is owned. */
  position: PositionContext | null;
  fetches: { dataset: string; status: string; sourceKey: string; startedAt: string; completedAt: string | null; errorMessage: string | null }[];
  issues: { severity: string; code: string; message: string; detectedAt: string }[];
  settings: Pick<AppSettings, "aaaBondYield" | "currentCpi" | "valuation" | "decision" | "freshness">;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The most recent statements request failed (stored figures are then served as CACHED). */
function lastFundamentalsFetchFailed(fetches: { dataset: string; status: string }[]): boolean {
  const last = fetches.find((f) => f.dataset === "annual-financials");
  return last?.status === "FAILED";
}


export async function findSecurity(exchangeCode: string, ticker: string) {
  return db.security.findFirst({
    where: { ticker: ticker.toUpperCase(), exchange: { code: exchangeCode.toUpperCase() } },
    include: { exchange: true, source: true },
  });
}

/** Load stored data for a security and run every engine. Read-only. */
export async function getSecurityAnalysis(
  securityId: string,
  options: { growthPercentOverride?: number | null; quote?: QuoteView; strategy?: Strategy | null; position?: PositionContext | null } = {},
): Promise<SecurityAnalysis | null> {
  const security = await db.security.findUnique({ where: { id: securityId }, include: { exchange: true, source: true } });
  if (!security) return null;
  const settings = await getSettings();
  // Never triggers a provider request by itself: the page fetches the quote explicitly.
  const quote = options.quote ?? (await getQuoteView(securityId, { noFetch: true }));

  const [statements, quarterlyStatements, bars, actions, fetches, issues, openVerifications, lastVerification, sourceFetches] = await Promise.all([
    db.financialStatement.findMany({
      where: { securityId, periodType: "ANNUAL" },
      include: { lineItems: true, source: true, fetch: true },
      orderBy: { periodEnd: "asc" },
    }),
    db.financialStatement.findMany({
      where: { securityId, periodType: "QUARTERLY" },
      include: { lineItems: true },
      orderBy: { periodEnd: "desc" },
      take: 3 * 12,
    }),
    db.priceBar.findMany({ where: { securityId }, orderBy: { date: "asc" }, include: { source: true } }),
    db.corporateAction.findMany({ where: { securityId }, orderBy: { exDate: "asc" } }),
    db.dataFetch.findMany({ where: { securityId }, orderBy: { startedAt: "desc" }, take: 10, include: { source: true } }),
    db.dataQualityIssue.findMany({ where: { securityId, resolvedAt: null }, orderBy: { detectedAt: "desc" } }),
    db.dataVerification.findMany({ where: { securityId, resolvedAt: null } }),
    db.dataVerification.findFirst({ where: { securityId, dataset: "financials" }, orderBy: { checkedAt: "desc" } }),
    db.dataFetch.findMany({ where: { securityId }, orderBy: { startedAt: "desc" }, take: 200, include: { source: true } }),
  ]);

  // Merge statement types per fiscal period. Prefer non-fixture sources when both exist.
  const byEnd = new Map<string, { annual: AnnualFinancials; prov: PeriodProvenance; fixture: boolean }>();
  for (const st of statements) {
    const end = iso(st.periodEnd);
    const existing = byEnd.get(end);
    if (existing && existing.fixture === false && st.source.isDevFixture) continue;
    if (existing && existing.fixture && !st.source.isDevFixture) byEnd.delete(end);
    const entry =
      byEnd.get(end) ??
      {
        annual: { fiscalYear: st.fiscalYear, periodEnd: end, currency: st.currency, values: {} },
        prov: {
          fiscalYear: st.fiscalYear,
          periodEnd: end,
          sourceKey: st.source.key,
          sourceName: st.source.name,
          isDevFixture: st.source.isDevFixture,
          form: st.form,
          accessionNumber: st.accessionNumber,
          filingUrl: st.accessionNumber && security.cik && st.source.key === "sec-edgar" ? filingUrl(security.cik, st.accessionNumber) : null,
          filedAt: st.filedAt ? iso(st.filedAt) : null,
          retrievedAt: (st.fetch?.completedAt ?? st.updatedAt).toISOString(),
          isRestated: st.isRestated,
          concepts: {},
          units: {},
          verification: {},
        },
        fixture: st.source.isDevFixture,
      };
    for (const li of st.lineItems) {
      entry.annual.values[li.concept as CanonicalConcept] = Number(li.value);
      entry.prov.concepts[li.concept as CanonicalConcept] = li.sourceConcept;
      entry.prov.units[li.concept as CanonicalConcept] = li.unit;
      entry.prov.verification[li.concept as CanonicalConcept] = li.verificationStatus;
    }
    entry.prov.isRestated ||= st.isRestated;
    byEnd.set(end, entry);
  }
  const periods = [...byEnd.values()].sort((a, b) => a.annual.fiscalYear - b.annual.fiscalYear);
  const annual = periods.map((p) => p.annual);
  const provenance = periods.map((p) => p.prov);

  const lastBar = bars[bars.length - 1];
  const quoteDate = quote.sourceTimestamp ? localDate(quote.sourceTimestamp, quote.timezone) : null;
  const price =
    quote.price !== null && quoteDate
      ? {
          value: quote.price,
          date: quoteDate,
          currency: quote.currency,
          sourceKey: quote.provider?.key ?? "unknown",
          isDevFixture: quote.provider?.key === "dev-fixture",
          status: quote.status,
          sourceTimestamp: quote.sourceTimestamp,
        }
      : null;

  const dividendRows = actions.filter((a) => a.type === "CASH_DIVIDEND" && a.amount !== null);
  const priceSourceName = bars.length ? bars[bars.length - 1].source.name : undefined;
  const cpi: CpiReference = settings.currentCpi
    ? {
        baseYear: CPI_DEFAULT.baseYear,
        baseValue: CPI_DEFAULT.baseValue,
        currentLabel: settings.currentCpi.asOf,
        currentValue: settings.currentCpi.value,
        sourceLabel: settings.currentCpi.source,
        sourceUrl: null,
      }
    : { ...CPI_DEFAULT };

  const inputs: GrahamInputs = {
    annual,
    price: price ? { value: price.value, date: price.date, currency: price.currency, sourceName: price.sourceKey } : null,
    classification: classifyIssuer({ sicCode: security.sicCode, assetType: security.assetType, isUtility: security.isUtility, latest: annual[annual.length - 1] ?? null }),
    dividends: dividendRows.map((d) => ({ exDate: iso(d.exDate), amount: Number(d.amount) })),
    dividendSourceName: priceSourceName,
    closes: bars.map((b) => ({ date: iso(b.date), close: Number(b.close) })),
    priceHistoryRange: bars.length ? { first: iso(bars[0].date), last: iso(lastBar.date) } : null,
    fiscalYearEndMonth: security.fiscalYearEndMonth,
    provenance: provenance.map((p) => ({
      fiscalYear: p.fiscalYear,
      periodEnd: p.periodEnd,
      sourceName: p.sourceName,
      form: p.form,
      accessionNumber: p.accessionNumber,
      filingUrl: p.filingUrl,
      concepts: p.concepts,
    })),
    cpi,
    enterprisingLookbackYears: settings.enterprisingLookbackYears,
  };
  const graham = analyzeGraham(inputs);
  const { defensive, enterprising } = graham;
  const lastCurrency = annual[annual.length - 1]?.currency;
  const comparablePrice = price && price.currency === lastCurrency ? price.value : null;
  const valuation = valueWithGraham({ annual, price: comparablePrice, growthPercentOverride: options.growthPercentOverride });
  const aaa = settings.aaaBondYield?.value ?? null;
  const modern = {
    bondYieldAdjusted: bondYieldAdjustedFormula({ earnings: valuation.normalEarnings, growthPercent: valuation.growthPercentUsed, aaaYieldPercent: aaa, rejectedHistoricalGrowth: valuation.rejectedHistoricalGrowth }),
    metrics: modernMetrics({ annual, price: comparablePrice, normalEarnings: valuation.normalEarnings, aaaYieldPercent: aaa }),
  };

  const today = iso(new Date());
  const valuationDashboard = buildValuationDashboard({
    graham,
    currency: lastCurrency ?? null,
    price: resolvePriceContext({
      quote: price
        ? { value: price.value, currency: price.currency, date: price.date, timestamp: price.sourceTimestamp, source: quote.provider?.name ?? price.sourceKey, quoteStatus: price.status }
        : null,
      storedClose: lastBar ? { value: Number(lastBar.close), date: iso(lastBar.date), currency: lastBar.currency, source: lastBar.source.name } : null,
      statementCurrency: lastCurrency ?? null,
      today,
      staleAfterDays: settings.freshness.priceStaleDays,
    }),
  });
  const intrinsicBase = buildIntrinsicBase(annual, graham.classification.industryClass);
  const intrinsicDefaults = defaultAssumptions(intrinsicBase, {
    enabled: settings.valuation.intrinsicEnabled,
    discountRate: settings.valuation.discountRate,
    terminalGrowth: settings.valuation.terminalGrowth,
    normalizationYears: settings.valuation.normalizationYears,
  });
  const intrinsic = { base: intrinsicBase, defaults: intrinsicDefaults, result: computeIntrinsicValue(intrinsicBase, intrinsicDefaults.assumptions) };
  const fairValue = buildFairValue({
    intrinsic: intrinsic.result,
    graham: valuation,
    ncavPerShare: graham.netNet.ncavPerShare,
    grahamNumber: valuationDashboard.grahamNumber.ceiling.value,
    netNetThreshold: valuationDashboard.netNet.ceiling.value,
    price: valuationDashboard.price.comparable,
    currency: lastCurrency ?? null,
    historicalRevenueGrowth: intrinsicDefaults.historical.revenueCagr,
  });
  const fundamentalsFixture = provenance.some((p) => p.isDevFixture);
  const freshness: FreshnessReport = {
    prices: priceFreshness(price?.date ?? null, today, price?.isDevFixture ?? false, settings.freshness),
    fundamentals: fundamentalsFreshness(annual[annual.length - 1]?.periodEnd ?? null, today, fundamentalsFixture, settings.freshness),
    issues: validateAnnualFinancials(annual),
    usesDevFixtureData: Boolean(price?.isDevFixture) || fundamentalsFixture || security.source?.isDevFixture === true,
  };

  const latestAnnual = annual[annual.length - 1] ?? null;
  const maxFiledAt = [...statements, ...quarterlyStatements].reduce<string | null>((m, st) => {
    const f = st.filedAt ? iso(st.filedAt) : null;
    return f && (!m || f > m) ? f : m;
  }, null);
  const latestFilingDate = security.latestFilingDate ? iso(security.latestFilingDate) : null;
  // A newer original report (amendments excluded: many carry no financial data) than anything stored.
  const newerFiling =
    security.latestFilingAccession && latestFilingDate && security.latestFilingForm && !security.latestFilingForm.endsWith("/A") && (!maxFiledAt || latestFilingDate > maxFiledAt)
      ? { form: security.latestFilingForm, filedAt: latestFilingDate, accessionNumber: security.latestFilingAccession }
      : null;
  const conflictRows = openVerifications.filter((v) => v.status === "CONFLICT");
  const gate = evaluateDataSufficiency({
    quoteStatus: quote.status,
    fundamentals: freshness.fundamentals,
    latestAnnual: latestAnnual?.values ?? null,
    conflicts: conflictRows.filter((v) => v.dataset === "financials").map((v) => ({ metric: v.metric, fiscalYear: v.fiscalYear, fiscalPeriod: v.fiscalPeriod })),
    newerFiling,
    quoteConflict: quote.verification.status === "CONFLICT",
    usesDevFixtureData: freshness.usesDevFixtureData,
    industryClass: inputs.classification?.industryClass ?? null,
  });
  const finVerifications = openVerifications.filter((v) => v.dataset === "financials");
  const health: DataHealth = {
    gate,
    latestQuoteTimestamp: quote.sourceTimestamp,
    latestFiling: security.latestFilingAccession
      ? {
          form: security.latestFilingForm,
          filingDate: latestFilingDate,
          acceptedAt: security.latestFilingAcceptedAt?.toISOString() ?? null,
          accessionNumber: security.latestFilingAccession,
          url: security.cik ? filingUrl(security.cik, security.latestFilingAccession) : null,
        }
      : maxFiledAt
        ? { form: null, filingDate: maxFiledAt, acceptedAt: null, accessionNumber: null, url: null }
        : null,
    newerFiling,
    fundamentalsStatus: fundamentalsStatus({
      freshness: freshness.fundamentals,
      newerFiling: newerFiling !== null,
      lastRefreshFailed: lastFundamentalsFetchFailed(sourceFetches),
      conflicted: conflictRows.some((v) => v.dataset === "financials"),
    }),
    lastFilingCheckAt: security.lastFilingCheckAt?.toISOString() ?? null,
    lastSuccessfulRefreshAt: sourceFetches.find((f) => f.status === "SUCCESS" || f.status === "PARTIAL")?.completedAt?.toISOString() ?? null,
    conflicts: conflictRows.map((v) => ({
      dataset: v.dataset,
      metric: v.metric,
      fiscalYear: v.fiscalYear,
      fiscalPeriod: v.fiscalPeriod,
      primarySource: v.primarySource,
      primaryValue: v.primaryValue === null ? null : Number(v.primaryValue),
      primaryReference: v.primaryReference,
      secondarySource: v.secondarySource,
      secondaryValue: v.secondaryValue === null ? null : Number(v.secondaryValue),
      relDiff: v.relDiff,
      checkedAt: v.checkedAt.toISOString(),
    })),
    verification: {
      verified: finVerifications.filter((v) => v.status === "VERIFIED").length,
      conflict: finVerifications.filter((v) => v.status === "CONFLICT").length,
      singleSource: finVerifications.filter((v) => v.status === "SINGLE_SOURCE").length,
      unverified: finVerifications.filter((v) => v.status === "UNVERIFIED").length,
      lastCheckedAt: lastVerification?.checkedAt.toISOString() ?? null,
      source: lastVerification?.secondarySource ?? null,
    },
    providers: providerHealth(sourceFetches),
  };

  const position = options.position !== undefined ? options.position : await loadPosition(securityId);
  const decisionSettings: DecisionSettings = settings.decision;
  const decision = evaluateDecision({
    strategy: options.strategy ?? decisionSettings.strategy,
    graham,
    dashboard: valuationDashboard,
    intrinsic: intrinsic.result,
    marginOfSafetyTarget: settings.valuation.marginOfSafetyTarget,
    gate,
    freshness,
    verification: health.verification.lastCheckedAt ? health.verification : null,
    position,
    settings: decisionSettings,
    fundamentalsStaleMonths: settings.freshness.fundamentalsStaleMonths,
  });

  const quarterly: QuarterRow[] = [];
  const qByEnd = new Map<string, QuarterRow>();
  for (const st of quarterlyStatements) {
    const end = iso(st.periodEnd);
    const row = qByEnd.get(end) ?? { fiscalYear: st.fiscalYear, fiscalPeriod: st.fiscalPeriod, periodEnd: end, currency: st.currency, filedAt: st.filedAt ? iso(st.filedAt) : null, form: st.form, accessionNumber: st.accessionNumber, values: {} };
    for (const li of st.lineItems) row.values[li.concept as CanonicalConcept] = Number(li.value);
    if (!qByEnd.has(end)) {
      qByEnd.set(end, row);
      quarterly.push(row);
    }
  }

  // Chart series: split- and dividend-adjusted close (Tiingo adjClose), so a split is not drawn
  // as a crash (NVDA 10:1 in 2024, GOOGL 20:1 in 2022). The latest adjusted close equals the
  // latest close, so today's price lines up with the current per-share thresholds. Bars without
  // an adjusted value fall back to the raw close only when no split exists after them.
  const history = adjustedChartSeries(
    bars.map((b) => ({ date: iso(b.date), close: Number(b.close), adjClose: b.adjClose === null ? null : Number(b.adjClose) })),
    actions.filter((a) => a.type === "STOCK_SPLIT").map((a) => iso(a.exDate)),
  );
  // Down-sample long histories to weekly closes for charting (keeps the RSC payload small).
  const priceHistory = history.length > 1500 ? history.filter((_, i) => i % 5 === 0 || i === history.length - 1) : history;

  return {
    security: {
      id: security.id,
      ticker: security.ticker,
      name: security.name,
      nameHe: security.nameHe,
      exchangeCode: security.exchange.code,
      exchangeName: security.exchange.name,
      market: security.exchange.market,
      cik: security.cik,
      sector: security.sector,
      industry: security.industry,
      isUtility: security.isUtility,
      sicCode: security.sicCode,
      assetType: security.assetType,
      fiscalYearEndMonth: security.fiscalYearEndMonth,
      reportingCurrency: security.reportingCurrency,
      isDevFixture: security.source?.isDevFixture ?? false,
    },
    price,
    quote,
    health,
    quarterly: quarterly.slice(0, 12),
    interim: computeInterimHealth(annual, quarterly),
    priceHistory,
    priceHistorySource: priceSourceName ?? null,
    dividends: dividendRows
      .filter((d) => !graham.excludedDistributions.some((x) => x.exDate === iso(d.exDate)))
      .slice(-40)
      .map((d) => ({ exDate: iso(d.exDate), amount: Number(d.amount), currency: d.currency })),
    annual,
    provenance,
    defensive,
    enterprising,
    graham,
    valuation,
    modern,
    valuationDashboard,
    intrinsic,
    fairValue,
    freshness,
    decision,
    position,
    fetches: fetches.map((f) => ({
      dataset: f.dataset,
      status: f.status,
      sourceKey: f.source.key,
      startedAt: f.startedAt.toISOString(),
      completedAt: f.completedAt?.toISOString() ?? null,
      errorMessage: f.errorMessage,
    })),
    issues: issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message, detectedAt: i.detectedAt.toISOString() })),
    settings: { aaaBondYield: settings.aaaBondYield, currentCpi: settings.currentCpi, valuation: settings.valuation, decision: settings.decision, freshness: settings.freshness },
  };
}

/** The position in the default portfolio, with its market-value weight (null when not owned). */
async function loadPosition(securityId: string): Promise<PositionContext | null> {
  const row = await db.position.findFirst({ where: { securityId }, orderBy: { createdAt: "asc" } });
  if (!row) return null;
  const { holdings } = await getPortfolioSummary();
  // Portfolio-wide weight: null when another currency cannot be converted with a sourced FX rate.
  const valued = holdings.holdings.find((p) => p.id === row.id);
  const thesis = row.thesisStrategy;
  return {
    quantity: Number(row.quantity),
    averageCost: Number(row.averageCost),
    currency: row.currency,
    weight: valued?.weight ?? null,
    marketValue: valued?.marketValue ?? null,
    thesisStrategy: thesis === "DEFENSIVE" || thesis === "ENTERPRISING" || thesis === "NET_NET" ? thesis : null,
    openedAt: row.openedAt ? iso(row.openedAt) : null,
  };
}

function localDate(isoInstant: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoInstant));
}

function providerHealth(fetches: { status: string; startedAt: Date; completedAt: Date | null; errorMessage: string | null; source: { key: string } }[]): ProviderHealth[] {
  return providerStatuses()
    .filter((p) => !p.isDevFixture)
    .map((p) => {
      const mine = fetches.filter((f) => f.source.key === p.key);
      const lastOk = mine.find((f) => f.status === "SUCCESS" || f.status === "PARTIAL");
      const lastFail = mine.find((f) => f.status === "FAILED");
      let consecutive = 0;
      for (const f of mine) {
        if (f.status === "FAILED") consecutive++;
        else if (f.status !== "RUNNING") break;
      }
      const state: ProviderHealth["state"] = !p.configured
        ? "NOT_CONFIGURED"
        : mine.length === 0
          ? "UNUSED"
          : consecutive === 0
            ? "OK"
            : lastOk
              ? "DEGRADED"
              : "DOWN";
      return {
        key: p.key,
        name: p.name,
        configured: p.configured,
        missingEnv: p.missingEnv,
        capabilities: p.capabilities,
        lastSuccessAt: lastOk?.completedAt?.toISOString() ?? null,
        lastFailureAt: lastFail?.startedAt.toISOString() ?? null,
        lastError: lastFail?.errorMessage ?? null,
        consecutiveFailures: consecutive,
        state,
      };
    });
}

// Same canonical SHA-256 as decision snapshots: independent of key order.
const hash = stableHash;

/** Persist immutable snapshots of the current engine outputs, with their inputs. */
export async function saveAnalysisSnapshots(securityId: string) {
  const a = await getSecurityAnalysis(securityId);
  if (!a) return { saved: false as const };
  // The decision snapshot keeps its own history (deduplicated by its own inputs hash).
  await persistDecisionSnapshot(a, "REFRESH");
  const asOfDate = new Date((a.price?.date ?? new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
  const inputs = { annual: a.annual, price: a.price ? { value: a.price.value, date: a.price.date, currency: a.price.currency, sourceKey: a.price.sourceKey } : null } as unknown as Prisma.InputJsonValue;
  const inputsHash = hash(inputs);
  // Calculations are only re-recorded when their underlying data changed.
  const previous = await db.analysisSnapshot.findFirst({ where: { securityId, engine: "graham-defensive" }, orderBy: { computedAt: "desc" } });
  if (previous?.inputsHash === inputsHash) return { saved: false as const };
  const common = {
    securityId,
    asOfDate,
    priceUsed: a.price?.value ?? null,
    inputs,
    inputsHash,
    dataQuality: { freshness: a.freshness, gate: a.health.gate, quoteStatus: a.quote.status } as unknown as Prisma.InputJsonValue,
    usesDevFixtureData: a.freshness.usesDevFixtureData,
  };
  await db.analysisSnapshot.createMany({
    data: [
      { ...common, engine: "graham-defensive", engineVersion: GRAHAM_ENGINE_VERSION, methodology: "GRAHAM_1973", results: a.defensive as unknown as Prisma.InputJsonValue },
      { ...common, engine: "graham-enterprising", engineVersion: GRAHAM_ENGINE_VERSION, methodology: "GRAHAM_1973", results: a.enterprising as unknown as Prisma.InputJsonValue },
      { ...common, engine: "graham-net-net", engineVersion: GRAHAM_ENGINE_VERSION, methodology: "GRAHAM_1973", results: a.graham.netNet as unknown as Prisma.InputJsonValue },
      { ...common, engine: "valuation", engineVersion: VALUATION_ENGINE_VERSION, methodology: "GRAHAM_1973", results: a.valuation as unknown as Prisma.InputJsonValue },
      { ...common, engine: "modern-extensions", engineVersion: VALUATION_ENGINE_VERSION, methodology: "MODERN_EXTENSION", results: a.modern as unknown as Prisma.InputJsonValue },
    ],
  });
  return { saved: true as const };
}
