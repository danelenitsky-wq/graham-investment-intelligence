import "server-only";
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import { filingUrl } from "@/lib/providers/sec-edgar/parse";
import { verificationStatementsProviderFor } from "@/lib/providers/registry";
import { ProviderError, type MarketCode } from "@/lib/providers/types";
import { verifyDividendYears, verifyPeriods, type MetricComparison, type SourcedPeriod } from "@/lib/verification";
import { db } from "./db";
import { ensureSource, failFetch, finishFetch, startFetch, type RefreshOutcome } from "./ingestion";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const LIMIT = { ANNUAL: 10, QUARTERLY: 8 } as const;

/** Stored primary-source periods (SEC) in the shape the verifier compares. */
async function primaryPeriods(securityId: string, periodType: "ANNUAL" | "QUARTERLY", cik: string | null) {
  const statements = await db.financialStatement.findMany({
    where: { securityId, periodType, source: { isDevFixture: false, key: "sec-edgar" } },
    include: { lineItems: true },
    orderBy: { periodEnd: "desc" },
  });
  const byEnd = new Map<string, SourcedPeriod & { statementIds: string[] }>();
  for (const st of statements) {
    const end = iso(st.periodEnd);
    const p = byEnd.get(end) ?? {
      periodEnd: end,
      fiscalYear: st.fiscalYear,
      fiscalPeriod: st.fiscalPeriod,
      values: {},
      reference: st.accessionNumber ? (cik ? filingUrl(cik, st.accessionNumber) : st.accessionNumber) : null,
      statementIds: [],
    };
    for (const li of st.lineItems) p.values[li.concept as CanonicalConcept] = Number(li.value);
    p.statementIds.push(st.id);
    byEnd.set(end, p);
  }
  return [...byEnd.values()].slice(0, LIMIT[periodType]);
}

/**
 * Compare stored SEC figures with an independent provider (FMP) and record the
 * outcome per metric. Previous open checks are superseded, never deleted.
 */
export async function verifyFundamentals(securityId: string): Promise<NonNullable<RefreshOutcome["verification"]>> {
  const security = await db.security.findUniqueOrThrow({ where: { id: securityId }, include: { exchange: true } });
  const provider = verificationStatementsProviderFor(security.exchange.market as MarketCode);
  if (!provider) return { status: "SKIPPED", code: "NOT_CONFIGURED" };
  const source = await ensureSource(provider.descriptor);
  // After the provider said an endpoint is not in the plan, pause for a day instead of retrying every refresh.
  const denied = await db.dataFetch.findFirst({
    where: { sourceId: source.id, dataset: { startsWith: "verification-" }, status: "FAILED", httpStatus: 402, startedAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (denied) return { status: "SKIPPED", code: "NOT_ENTITLED", error: "Independent source endpoint is not in the free plan; paused for 24 h." };
  const ref = { ticker: security.ticker, exchangeCode: security.exchange.code, cik: security.cik };
  const splits = await db.corporateAction.findMany({ where: { securityId, type: "STOCK_SPLIT" } });
  const splitFactorAfter = (date: string) => splits.filter((s) => iso(s.exDate) > date).reduce((f, s) => f * Number(s.ratio), 1);

  const comparisons: (MetricComparison & { periodType: "ANNUAL" | "QUARTERLY" })[] = [];
  const errors: string[] = [];
  let anySuccess = false;
  for (const [periodType, period] of [
    ["ANNUAL", "annual"],
    ["QUARTERLY", "quarter"],
  ] as const) {
    const primary = await primaryPeriods(securityId, periodType, security.cik);
    if (primary.length === 0) continue;
    if (provider.supportsPeriod && !provider.supportsPeriod(period)) continue;
    const fetch = await startFetch(source.id, `verification-${period}`, provider.descriptor.baseUrl, securityId);
    try {
      const { periods, currency, meta } = await provider.getStatements(ref, period);
      const sameCurrency = !currency || currency === (security.reportingCurrency ?? "USD");
      if (sameCurrency) for (const c of verifyPeriods(primary, periods, { splitFactorAfter })) comparisons.push({ ...c, periodType });
      await finishFetch(fetch.id, {
        status: sameCurrency ? "SUCCESS" : "PARTIAL",
        endpoint: meta.endpoint,
        httpStatus: meta.httpStatus,
        payloadHash: meta.payloadHash,
        recordCount: periods.length,
        errorMessage: sameCurrency ? null : `Verification source reports in ${currency}; not compared`,
      });
      anySuccess = true;
    } catch (e) {
      // A plan restriction is recorded with HTTP 402 so the 24 h pause above applies.
      if (e instanceof ProviderError && e.code === "NOT_ENTITLED") {
        await failFetch(fetch.id, new ProviderError(e.provider, e.code, e.message, 402, e.endpoint));
        return { status: "SKIPPED", code: "NOT_ENTITLED", error: e.message };
      }
      await failFetch(fetch.id, e);
      errors.push(e instanceof ProviderError ? `${e.code}: ${e.message}` : String(e));
    }
  }
  if (!anySuccess) return { status: errors.length ? "FAILED" : "SKIPPED", error: errors.join("; ") || undefined };

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.dataVerification.updateMany({ where: { securityId, dataset: "financials", resolvedAt: null }, data: { resolvedAt: now } });
    if (comparisons.length) {
      await tx.dataVerification.createMany({
        data: comparisons.map((c) => ({
          securityId,
          dataset: "financials",
          metric: c.metric,
          periodType: c.periodType,
          fiscalYear: c.fiscalYear,
          fiscalPeriod: c.fiscalPeriod,
          periodEnd: new Date(c.periodEnd + "T00:00:00Z"),
          primarySource: "sec-edgar",
          primaryValue: c.primaryValue,
          primaryReference: c.primaryReference,
          secondarySource: provider.descriptor.key,
          secondaryValue: c.secondaryValue,
          secondaryReference: c.secondaryReference,
          relDiff: c.relDiff,
          tolerance: c.tolerance.rel,
          status: c.status,
          checkedAt: now,
        })),
      });
    }
    // Mirror the outcome on the line items so every stored figure carries its verification status.
    for (const c of comparisons) {
      await tx.financialLineItem.updateMany({
        where: {
          concept: c.metric,
          statement: { securityId, periodType: c.periodType, periodEnd: new Date(c.periodEnd + "T00:00:00Z"), source: { key: "sec-edgar" } },
        },
        data: { verificationStatus: c.status },
      });
    }
  });
  const conflicts = comparisons.filter((c) => c.status === "CONFLICT").length;
  return { status: errors.length ? "FAILED" : "SUCCESS", compared: comparisons.length, conflicts, error: errors.join("; ") || undefined };
}

/**
 * Cross-check stored provider dividends (Tiingo) against SEC dividends
 * declared per share. Matching fiscal years mark their payments VERIFIED;
 * everything else stays SINGLE_SOURCE.
 */
export async function verifyDividends(securityId: string): Promise<{ verifiedYears: number; comparedYears: number }> {
  const [items, dividends, splits] = await Promise.all([
    db.financialLineItem.findMany({
      where: { concept: "dividendsPerShare", statement: { securityId, periodType: "ANNUAL", source: { key: "sec-edgar" } } },
      include: { statement: true },
    }),
    db.corporateAction.findMany({ where: { securityId, type: "CASH_DIVIDEND", source: { isDevFixture: false } } }),
    db.corporateAction.findMany({ where: { securityId, type: "STOCK_SPLIT" } }),
  ]);
  if (items.length === 0 || dividends.length === 0) return { verifiedYears: 0, comparedYears: 0 };
  const factorAfter = (date: string) => splits.filter((s) => iso(s.exDate) > date).reduce((f, s) => f * Number(s.ratio), 1);
  const adjustedByYear = new Map(items.map((i) => [i.statement.fiscalYear, i.splitAdjusted]));
  const secYears = items.map((i) => ({
    fiscalYear: i.statement.fiscalYear,
    periodStart: i.statement.periodStart ? iso(i.statement.periodStart) : null,
    periodEnd: iso(i.statement.periodEnd),
    value: Number(i.value),
  }));
  const checks = verifyDividendYears(
    dividends.map((d) => ({ exDate: iso(d.exDate), amount: Number(d.amount) })),
    secYears,
    // Tiingo divCash is as paid; SEC per-share values are on the current share basis when split-adjusted.
    (exDate, amount, periodEnd) => {
      const fy = secYears.find((y) => y.periodEnd === periodEnd)?.fiscalYear;
      const toCurrent = amount / factorAfter(exDate);
      return fy !== undefined && adjustedByYear.get(fy) ? toCurrent : amount / (factorAfter(exDate) / factorAfter(periodEnd));
    },
  );
  const verifiedDates = checks.filter((c) => c.status === "VERIFIED").flatMap((c) => c.exDates);
  await db.$transaction([
    db.corporateAction.updateMany({ where: { securityId, type: "CASH_DIVIDEND", source: { isDevFixture: false } }, data: { verificationStatus: "SINGLE_SOURCE" } }),
    db.corporateAction.updateMany({
      where: { securityId, type: "CASH_DIVIDEND", exDate: { in: verifiedDates.map((d) => new Date(d + "T00:00:00Z")) } },
      data: { verificationStatus: "VERIFIED" },
    }),
  ]);
  return { verifiedYears: checks.filter((c) => c.status === "VERIFIED").length, comparedYears: checks.length };
}
