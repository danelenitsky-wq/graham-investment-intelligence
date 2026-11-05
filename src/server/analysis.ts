import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { evaluateDecision, type DecisionResult } from "@/lib/decision";
import {
  fundamentalsFreshness,
  priceFreshness,
  validateAnnualFinancials,
  type FreshnessReport,
} from "@/lib/freshness";
import { evaluateDefensive, evaluateEnterprising, GRAHAM_ENGINE_VERSION } from "@/lib/graham/rules";
import type { GrahamInputs, RuleResult, ScreenResult } from "@/lib/graham/types";
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { valueWithGraham, VALUATION_ENGINE_VERSION, type GrahamValuation, type ValueEstimate } from "@/lib/valuation/graham";
import { bondYieldAdjustedFormula, inflationAdjustedSize, modernMetrics, type ModernMetrics } from "@/lib/valuation/modern";
import type { AppSettings } from "@/lib/settings/schema";
import { db } from "./db";
import { getSettings } from "./settings";

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
  filedAt: string | null;
  isRestated: boolean;
  concepts: Partial<Record<CanonicalConcept, string>>; // concept → source taxonomy tag
}

export interface SecurityAnalysis {
  security: SecuritySummary;
  price: { value: number; date: string; currency: string; sourceKey: string; isDevFixture: boolean } | null;
  priceHistory: { date: string; close: number }[];
  dividends: { exDate: string; amount: number; currency: string | null }[];
  annual: AnnualFinancials[];
  provenance: PeriodProvenance[];
  defensive: ScreenResult;
  enterprising: ScreenResult;
  valuation: GrahamValuation;
  modern: { inflationAdjustedSize: RuleResult; bondYieldAdjusted: ValueEstimate; metrics: ModernMetrics };
  freshness: FreshnessReport;
  decision: DecisionResult;
  fetches: { dataset: string; status: string; sourceKey: string; startedAt: string; completedAt: string | null; errorMessage: string | null }[];
  issues: { severity: string; code: string; message: string; detectedAt: string }[];
  settings: Pick<AppSettings, "aaaBondYield" | "currentCpi">;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function fiscalYearOf(date: Date, fiscalYearEndMonth: number | null): number {
  const m = date.getUTCMonth() + 1;
  const y = date.getUTCFullYear();
  const fyEnd = fiscalYearEndMonth ?? 12;
  return m > fyEnd ? y + 1 : y;
}

export async function findSecurity(exchangeCode: string, ticker: string) {
  return db.security.findFirst({
    where: { ticker: ticker.toUpperCase(), exchange: { code: exchangeCode.toUpperCase() } },
    include: { exchange: true, source: true },
  });
}

/** Load stored data for a security and run every engine. Read-only. */
export async function getSecurityAnalysis(securityId: string, options: { growthPercentOverride?: number | null } = {}): Promise<SecurityAnalysis | null> {
  const security = await db.security.findUnique({ where: { id: securityId }, include: { exchange: true, source: true } });
  if (!security) return null;
  const settings = await getSettings();

  const [statements, bars, actions, fetches, issues] = await Promise.all([
    db.financialStatement.findMany({
      where: { securityId, periodType: "ANNUAL" },
      include: { lineItems: true, source: true },
      orderBy: { periodEnd: "asc" },
    }),
    db.priceBar.findMany({ where: { securityId }, orderBy: { date: "asc" }, include: { source: true } }),
    db.corporateAction.findMany({ where: { securityId }, orderBy: { exDate: "asc" } }),
    db.dataFetch.findMany({ where: { securityId }, orderBy: { startedAt: "desc" }, take: 10, include: { source: true } }),
    db.dataQualityIssue.findMany({ where: { securityId, resolvedAt: null }, orderBy: { detectedAt: "desc" } }),
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
          filedAt: st.filedAt ? iso(st.filedAt) : null,
          isRestated: st.isRestated,
          concepts: {},
        },
        fixture: st.source.isDevFixture,
      };
    for (const li of st.lineItems) {
      entry.annual.values[li.concept as CanonicalConcept] = Number(li.value);
      entry.prov.concepts[li.concept as CanonicalConcept] = li.sourceConcept;
    }
    entry.prov.isRestated ||= st.isRestated;
    byEnd.set(end, entry);
  }
  const periods = [...byEnd.values()].sort((a, b) => a.annual.fiscalYear - b.annual.fiscalYear);
  const annual = periods.map((p) => p.annual);
  const provenance = periods.map((p) => p.prov);

  const lastBar = bars[bars.length - 1];
  const price = lastBar
    ? { value: Number(lastBar.close), date: iso(lastBar.date), currency: lastBar.currency, sourceKey: lastBar.source.key, isDevFixture: lastBar.source.isDevFixture }
    : null;

  const dividendRows = actions.filter((a) => a.type === "CASH_DIVIDEND" && a.amount !== null);
  const dividendYears = [...new Set(dividendRows.map((d) => fiscalYearOf(d.exDate, security.fiscalYearEndMonth)))];
  // A fiscal year is "covered" by price-provider dividend data only when bars span it entirely.
  const coverage: number[] = [];
  if (bars.length) {
    const firstFy = fiscalYearOf(bars[0].date, security.fiscalYearEndMonth) + 1;
    const lastFy = fiscalYearOf(lastBar.date, security.fiscalYearEndMonth) - 1;
    for (let y = firstFy; y <= lastFy; y++) coverage.push(y);
  }

  const inputs: GrahamInputs = {
    annual,
    price: price ? { value: price.value, date: price.date, currency: price.currency } : null,
    isUtility: security.isUtility,
    dividendYears,
    dividendCoverageYears: coverage,
  };
  const defensive = evaluateDefensive(inputs);
  const enterprising = evaluateEnterprising(inputs, { earningsGrowthLookbackYears: settings.enterprisingLookbackYears });
  const lastCurrency = annual[annual.length - 1]?.currency;
  const comparablePrice = price && price.currency === lastCurrency ? price.value : null;
  const valuation = valueWithGraham({ annual, price: comparablePrice, growthPercentOverride: options.growthPercentOverride });
  const aaa = settings.aaaBondYield?.value ?? null;
  const modern = {
    inflationAdjustedSize: inflationAdjustedSize({ annual, isUtility: security.isUtility, currentCpi: settings.currentCpi?.value ?? null }),
    bondYieldAdjusted: bondYieldAdjustedFormula({ earnings: valuation.normalEarnings, growthPercent: valuation.growthPercentUsed, aaaYieldPercent: aaa }),
    metrics: modernMetrics({ annual, price: comparablePrice, normalEarnings: valuation.normalEarnings, aaaYieldPercent: aaa }),
  };

  const today = iso(new Date());
  const fundamentalsFixture = provenance.some((p) => p.isDevFixture);
  const freshness: FreshnessReport = {
    prices: priceFreshness(price?.date ?? null, today, price?.isDevFixture ?? false, settings.freshness),
    fundamentals: fundamentalsFreshness(annual[annual.length - 1]?.periodEnd ?? null, today, fundamentalsFixture, settings.freshness),
    issues: validateAnnualFinancials(annual),
    usesDevFixtureData: Boolean(price?.isDevFixture) || fundamentalsFixture || security.source?.isDevFixture === true,
  };

  // Down-sample long histories to weekly closes for charting (keeps the RSC payload small).
  const history = bars.map((b) => ({ date: iso(b.date), close: Number(b.close) }));
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
      reportingCurrency: security.reportingCurrency,
      isDevFixture: security.source?.isDevFixture ?? false,
    },
    price,
    priceHistory,
    dividends: dividendRows.slice(-40).map((d) => ({ exDate: iso(d.exDate), amount: Number(d.amount), currency: d.currency })),
    annual,
    provenance,
    defensive,
    enterprising,
    valuation,
    modern,
    freshness,
    decision: evaluateDecision({ defensive, enterprising, valuation, freshness }),
    fetches: fetches.map((f) => ({
      dataset: f.dataset,
      status: f.status,
      sourceKey: f.source.key,
      startedAt: f.startedAt.toISOString(),
      completedAt: f.completedAt?.toISOString() ?? null,
      errorMessage: f.errorMessage,
    })),
    issues: issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message, detectedAt: i.detectedAt.toISOString() })),
    settings: { aaaBondYield: settings.aaaBondYield, currentCpi: settings.currentCpi },
  };
}

function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

/** Persist immutable snapshots of the current engine outputs, with their inputs. */
export async function saveAnalysisSnapshots(securityId: string) {
  const a = await getSecurityAnalysis(securityId);
  if (!a) return;
  const asOfDate = new Date((a.price?.date ?? new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
  const inputs = { annual: a.annual, price: a.price } as unknown as Prisma.InputJsonValue;
  const inputsHash = hash(inputs);
  const common = {
    securityId,
    asOfDate,
    priceUsed: a.price?.value ?? null,
    inputs,
    inputsHash,
    dataQuality: a.freshness as unknown as Prisma.InputJsonValue,
    usesDevFixtureData: a.freshness.usesDevFixtureData,
  };
  await db.analysisSnapshot.createMany({
    data: [
      { ...common, engine: "graham-defensive", engineVersion: GRAHAM_ENGINE_VERSION, methodology: "GRAHAM_1973", results: a.defensive as unknown as Prisma.InputJsonValue },
      { ...common, engine: "graham-enterprising", engineVersion: GRAHAM_ENGINE_VERSION, methodology: "GRAHAM_1973", results: a.enterprising as unknown as Prisma.InputJsonValue },
      { ...common, engine: "valuation", engineVersion: VALUATION_ENGINE_VERSION, methodology: "GRAHAM_1973", results: a.valuation as unknown as Prisma.InputJsonValue },
      { ...common, engine: "modern-extensions", engineVersion: VALUATION_ENGINE_VERSION, methodology: "MODERN_EXTENSION", results: a.modern as unknown as Prisma.InputJsonValue },
    ],
  });
}
