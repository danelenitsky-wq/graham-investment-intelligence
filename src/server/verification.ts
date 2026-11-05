import "server-only";
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import { filingUrl } from "@/lib/providers/sec-edgar/parse";
import { verificationStatementsProviderFor } from "@/lib/providers/registry";
import { ProviderError, type MarketCode } from "@/lib/providers/types";
import { verifyPeriods, type MetricComparison, type SourcedPeriod } from "@/lib/verification";
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
