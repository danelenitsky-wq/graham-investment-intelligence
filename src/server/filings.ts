import "server-only";
import { filingsProviderFor } from "@/lib/providers/registry";
import { ProviderError, type MarketCode } from "@/lib/providers/types";
import { saveAnalysisSnapshots } from "./analysis";
import { db } from "./db";
import { ensureSource, failFetch, finishFetch, refreshFundamentals, startFetch } from "./ingestion";
import { verifyFundamentals } from "./verification";

export const FILING_CHECK_INTERVAL_HOURS = 24;

export interface FilingCheckResult {
  securityId: string;
  ticker: string;
  status: "NEW_FILING" | "UP_TO_DATE" | "SKIPPED" | "FAILED" | "NOT_DUE";
  latest?: { form: string; filingDate: string; accessionNumber: string };
  refreshed?: string;
  error?: string;
}

/**
 * Daily check for newly published periodic reports. When EDGAR lists a 10-K /
 * 10-Q newer than anything stored, statements are re-fetched and calculations
 * re-run; otherwise nothing else is requested.
 */
export async function checkFilings(securityId: string, options: { force?: boolean } = {}): Promise<FilingCheckResult> {
  const security = await db.security.findUniqueOrThrow({ where: { id: securityId }, include: { exchange: true } });
  const base = { securityId, ticker: security.ticker };
  if (
    !options.force &&
    security.lastFilingCheckAt &&
    Date.now() - security.lastFilingCheckAt.getTime() < FILING_CHECK_INTERVAL_HOURS * 3_600_000
  ) {
    return { ...base, status: "NOT_DUE" };
  }
  const provider = filingsProviderFor(security.exchange.market as MarketCode);
  if (!provider || !security.cik) return { ...base, status: "SKIPPED" };

  const source = await ensureSource(provider.descriptor);
  const fetch = await startFetch(source.id, "filings-index", provider.descriptor.baseUrl, securityId);
  try {
    const { filings, meta } = await provider.latestPeriodicFilings({ ticker: security.ticker, exchangeCode: security.exchange.code, cik: security.cik });
    await finishFetch(fetch.id, { status: "SUCCESS", endpoint: meta.endpoint, httpStatus: meta.httpStatus, payloadHash: meta.payloadHash, recordCount: filings.length });
    const latest = filings[0];
    await db.security.update({
      where: { id: securityId },
      data: {
        lastFilingCheckAt: new Date(),
        ...(latest && {
          latestFilingAccession: latest.accessionNumber,
          latestFilingForm: latest.form,
          latestFilingDate: new Date(latest.filingDate + "T00:00:00Z"),
          latestFilingAcceptedAt: latest.acceptedAt ? new Date(latest.acceptedAt) : null,
        }),
      },
    });
    if (!latest) return { ...base, status: "UP_TO_DATE" };
    const stored = await db.financialStatement.findFirst({ where: { securityId, accessionNumber: latest.accessionNumber } });
    const summary = { form: latest.form, filingDate: latest.filingDate, accessionNumber: latest.accessionNumber };
    if (stored) return { ...base, status: "UP_TO_DATE", latest: summary };

    const outcome = await refreshFundamentals(securityId);
    if (outcome.status === "SUCCESS" || outcome.status === "UNCHANGED") {
      await verifyFundamentals(securityId);
      await saveAnalysisSnapshots(securityId);
    }
    return { ...base, status: "NEW_FILING", latest: summary, refreshed: outcome.status, error: outcome.error };
  } catch (e) {
    await failFetch(fetch.id, e);
    return { ...base, status: "FAILED", error: e instanceof ProviderError ? `${e.code}: ${e.message}` : String(e) };
  }
}

/** Check every security the user follows (watchlist, portfolio, or with stored statements). */
export async function checkAllFilings(options: { force?: boolean } = {}): Promise<FilingCheckResult[]> {
  const securities = await db.security.findMany({
    where: {
      cik: { not: null },
      OR: [{ watchlistItems: { some: {} } }, { positions: { some: {} } }, { statements: { some: {} } }],
      NOT: { source: { isDevFixture: true } },
    },
    select: { id: true },
  });
  const results: FilingCheckResult[] = [];
  for (const s of securities) results.push(await checkFilings(s.id, options));
  return results;
}
