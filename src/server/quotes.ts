import "server-only";
import type { QuoteSnapshot } from "@/generated/prisma/client";
import { calendarForExchange, sessionCloseTime, sessionInfo, zonedTimeToUtc, type SessionInfo } from "@/lib/market/calendar";
import { classifyQuote, decideQuoteFetch, type FetchDecisionReason, type QuoteFeed, type QuoteReason, type QuoteStatus } from "@/lib/freshness/quote";
import { quoteProvidersFor } from "@/lib/providers/registry";
import { ProviderError, type MarketCode, type QuoteProvider } from "@/lib/providers/types";
import { quoteCloses, verifyQuote, type VerificationStatus } from "@/lib/verification";
import { db } from "./db";
import { ensureSource, failFetch, finishFetch, startFetch } from "./ingestion";

export interface QuoteAttempt {
  provider: string;
  fetchId: string;
  ok: boolean;
  httpStatus: number | null;
  code: string | null;
  error: string | null;
  at: string;
}

export interface QuoteView {
  securityId: string;
  ticker: string;
  exchangeCode: string;
  timezone: string;
  status: QuoteStatus;
  baseStatus: QuoteStatus;
  reasons: QuoteReason[];
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  marketCapDerived: boolean;
  yearHigh: number | null;
  yearLow: number | null;
  yearRangeDerived: boolean;
  currency: string;
  exchange: string | null;
  sourceTimestamp: string | null;
  retrievedAt: string | null;
  ageSeconds: number | null;
  provider: { key: string; name: string } | null;
  feed: QuoteFeed | null;
  feedNote: string | null;
  verification: { status: VerificationStatus; note: string | null };
  servedFrom: "provider" | "cache" | "stored-eod" | "none";
  decision: FetchDecisionReason;
  /** Provider requests made while serving this call (empty when served from cache). */
  attempts: QuoteAttempt[];
  lastSuccessfulRefreshAt: string | null;
  lastFailedRefresh: { at: string; error: string | null } | null;
  configuredProviders: string[];
  session: SessionInfo;
  /** Poll interval the client should use, or null when auto refresh is not supported / not useful now. */
  autoRefreshSeconds: number | null;
}

const VERIFY_EVERY_MS = 15 * 60_000;
const inflight = new Map<string, Promise<QuoteView>>();

const n = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : Number(v));

/**
 * Latest quote for a security, honouring the cache policy. `force` (Refresh
 * Now) always issues a new provider request unless one was made in the last
 * two seconds. Concurrent calls for the same security share one request.
 */
export function getQuoteView(securityId: string, options: { force?: boolean; now?: Date; noFetch?: boolean } = {}): Promise<QuoteView> {
  const key = `${securityId}:${options.force ? "f" : options.noFetch ? "x" : "n"}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = loadQuoteView(securityId, options).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function loadQuoteView(securityId: string, { force = false, now = new Date(), noFetch = false }: { force?: boolean; now?: Date; noFetch?: boolean }): Promise<QuoteView> {
  const security = await db.security.findUniqueOrThrow({ where: { id: securityId }, include: { exchange: true } });
  const calendar = calendarForExchange(security.exchange.code, security.exchange.timezone);
  const session = sessionInfo(calendar, now);
  const providers = quoteProvidersFor(security.exchange.market as MarketCode);
  const ref = { ticker: security.ticker, exchangeCode: security.exchange.code, cik: security.cik };

  const [cached, lastAttempt] = await Promise.all([
    db.quoteSnapshot.findFirst({ where: { securityId }, orderBy: { retrievedAt: "desc" }, include: { source: true } }),
    db.dataFetch.findFirst({ where: { securityId, dataset: "quote" }, orderBy: { startedAt: "desc" } }),
  ]);
  const decision = noFetch ? { fetch: false, reason: "CACHE_FRESH" as const } : decideQuoteFetch({
    cached: cached ? { retrievedAt: cached.retrievedAt.toISOString(), sessionState: cached.sessionState as SessionInfo["state"], sessionDate: cached.sessionDate } : null,
    lastAttempt: lastAttempt ? { at: lastAttempt.startedAt.toISOString(), failed: lastAttempt.status === "FAILED" } : null,
    session,
    now,
    force,
    hasProvider: providers.length > 0,
  });

  const attempts: QuoteAttempt[] = [];
  let fresh: (QuoteSnapshot & { source: { key: string; name: string } }) | null = null;
  if (decision.fetch) {
    for (const [i, provider] of providers.entries()) {
      const r = await fetchAndStore(provider, ref, securityId, session);
      attempts.push(r.attempt);
      if (r.snapshot) {
        fresh = r.snapshot;
        const lastVerified = cached?.verificationStatus !== "UNVERIFIED" ? cached?.retrievedAt.getTime() ?? 0 : 0;
        // Cross-check with another provider that has not just failed in this call.
        const secondary = providers.find((p, j) => j !== i && !attempts.some((a) => a.provider === p.descriptor.key && !a.ok));
        if (secondary && (force || now.getTime() - lastVerified > VERIFY_EVERY_MS)) {
          fresh = await crossCheck(fresh, secondary, ref, securityId, attempts, calendar);
        }
        break;
      }
    }
  }

  const latest = fresh ?? cached;
  const lastFetchFailed =
    (attempts.length > 0 && !fresh) ||
    (attempts.length === 0 && lastAttempt?.status === "FAILED" && (!latest || lastAttempt.startedAt > latest.retrievedAt));

  // Without any quote provider (or before the first quote), fall back to the latest stored daily close.
  const eod = await latestStoredClose(securityId, calendar);
  const useEod = eod && (!latest || Date.parse(eod.sourceTimestamp) > latest.sourceTimestamp.getTime());

  const observation = useEod
    ? { price: eod.price, sourceTimestamp: eod.sourceTimestamp, retrievedAt: eod.retrievedAt, feed: "EOD" as const, delayMinutes: null }
    : latest
      ? { price: Number(latest.price), sourceTimestamp: latest.sourceTimestamp.toISOString(), retrievedAt: latest.retrievedAt.toISOString(), feed: latest.feed, delayMinutes: latest.delayMinutes }
      : null;
  const cls = classifyQuote({
    quote: observation,
    session,
    now,
    lastFetchFailed: Boolean(lastFetchFailed) && !useEod,
    conflicted: !useEod && latest?.verificationStatus === "CONFLICT",
  });

  const [lastOk, lastFail, derived] = await Promise.all([
    db.dataFetch.findFirst({ where: { securityId, dataset: "quote", status: "SUCCESS" }, orderBy: { startedAt: "desc" } }),
    db.dataFetch.findFirst({ where: { securityId, dataset: "quote", status: "FAILED" }, orderBy: { startedAt: "desc" } }),
    derivedFields(securityId, now),
  ]);

  const price = observation?.price ?? null;
  const previousClose = useEod ? eod!.previousClose : n(latest?.previousClose);
  const change = useEod ? (previousClose !== null && price !== null ? price - previousClose : null) : n(latest?.change);
  const changePercent = useEod ? (previousClose && price !== null ? price / previousClose - 1 : null) : (latest?.changePercent ?? null);
  const providerMarketCap = useEod ? null : n(latest?.marketCap);
  const providerYearHigh = useEod ? null : n(latest?.yearHigh);
  const providerYearLow = useEod ? null : n(latest?.yearLow);
  const primary = providers[0];
  const autoRefresh = primary?.supportsAutoRefresh() && session.state !== "CLOSED" ? 60 : null;

  return {
    securityId,
    ticker: security.ticker,
    exchangeCode: security.exchange.code,
    timezone: security.exchange.timezone,
    status: cls.status,
    baseStatus: cls.baseStatus,
    reasons: cls.reasons,
    price,
    previousClose,
    change,
    changePercent,
    marketCap: providerMarketCap ?? (price !== null && derived.sharesOutstanding ? price * derived.sharesOutstanding : null),
    marketCapDerived: providerMarketCap === null && price !== null && Boolean(derived.sharesOutstanding),
    yearHigh: providerYearHigh ?? derived.yearHigh,
    yearLow: providerYearLow ?? derived.yearLow,
    yearRangeDerived: providerYearHigh === null && derived.yearHigh !== null,
    currency: useEod ? eod!.currency : (latest?.currency ?? security.exchange.currency),
    exchange: useEod ? security.exchange.code : (latest?.exchange ?? security.exchange.code),
    sourceTimestamp: observation?.sourceTimestamp ?? null,
    retrievedAt: observation?.retrievedAt ?? null,
    ageSeconds: cls.ageSeconds,
    provider: useEod ? { key: eod!.sourceKey, name: eod!.sourceName } : latest ? { key: latest.source.key, name: latest.source.name } : null,
    feed: observation?.feed ?? null,
    feedNote: useEod ? null : (latest?.feedNote ?? null),
    verification: useEod
      ? { status: "SINGLE_SOURCE", note: null }
      : { status: (latest?.verificationStatus ?? "UNVERIFIED") as VerificationStatus, note: latest?.verificationNote ?? null },
    servedFrom: useEod ? "stored-eod" : fresh ? "provider" : latest ? "cache" : "none",
    decision: decision.reason,
    attempts,
    lastSuccessfulRefreshAt: lastOk?.completedAt?.toISOString() ?? null,
    lastFailedRefresh: lastFail ? { at: lastFail.startedAt.toISOString(), error: lastFail.errorMessage } : null,
    configuredProviders: providers.map((p) => p.descriptor.key),
    session,
    autoRefreshSeconds: autoRefresh,
  };
}

async function fetchAndStore(provider: QuoteProvider, ref: { ticker: string; exchangeCode: string; cik: string | null }, securityId: string, session: SessionInfo) {
  const source = await ensureSource(provider.descriptor);
  const fetch = await startFetch(source.id, "quote", provider.descriptor.baseUrl, securityId);
  try {
    const { quote, meta } = await provider.getQuote(ref);
    const snapshot = await db.quoteSnapshot.create({
      data: {
        securityId,
        sourceId: source.id,
        fetchId: fetch.id,
        price: quote.price,
        previousClose: quote.previousClose,
        change: quote.change,
        changePercent: quote.changePercent,
        open: quote.open,
        dayHigh: quote.dayHigh,
        dayLow: quote.dayLow,
        volume: quote.volume === null ? null : BigInt(Math.round(quote.volume)),
        marketCap: quote.marketCap,
        yearHigh: quote.yearHigh,
        yearLow: quote.yearLow,
        currency: quote.currency,
        exchange: quote.exchange,
        feed: quote.feed,
        feedNote: quote.feedNote,
        delayMinutes: quote.delayMinutes,
        sourceTimestamp: new Date(quote.sourceTimestamp),
        retrievedAt: new Date(meta.fetchedAt),
        sessionState: session.state,
        sessionDate: session.localDate,
        verificationStatus: "UNVERIFIED",
        payloadHash: meta.payloadHash,
      },
      include: { source: true },
    });
    await finishFetch(fetch.id, { status: "SUCCESS", endpoint: meta.endpoint, httpStatus: meta.httpStatus, payloadHash: meta.payloadHash, recordCount: 1 });
    return { snapshot, attempt: { provider: provider.descriptor.key, fetchId: fetch.id, ok: true, httpStatus: meta.httpStatus, code: null, error: null, at: meta.fetchedAt } };
  } catch (e) {
    await failFetch(fetch.id, e);
    const err = e instanceof ProviderError ? e : null;
    return {
      snapshot: null,
      attempt: {
        provider: provider.descriptor.key,
        fetchId: fetch.id,
        ok: false,
        httpStatus: err?.httpStatus ?? null,
        code: err?.code ?? "UNKNOWN",
        error: e instanceof Error ? e.message : String(e),
        at: new Date().toISOString(),
      },
    };
  }
}

/** Compare with an independent provider; the secondary quote is kept as its own snapshot. */
async function crossCheck(
  primary: QuoteSnapshot & { source: { key: string; name: string } },
  secondary: QuoteProvider,
  ref: { ticker: string; exchangeCode: string; cik: string | null },
  securityId: string,
  attempts: QuoteAttempt[],
  calendar: ReturnType<typeof calendarForExchange>,
) {
  const source = await ensureSource(secondary.descriptor);
  const fetch = await startFetch(source.id, "quote-verification", secondary.descriptor.baseUrl, securityId);
  try {
    const { quote, meta } = await secondary.getQuote(ref);
    await finishFetch(fetch.id, { status: "SUCCESS", endpoint: meta.endpoint, httpStatus: meta.httpStatus, payloadHash: meta.payloadHash, recordCount: 1 });
    attempts.push({ provider: secondary.descriptor.key, fetchId: fetch.id, ok: true, httpStatus: meta.httpStatus, code: null, error: null, at: meta.fetchedAt });
    const p = { price: Number(primary.price), previousClose: n(primary.previousClose), sourceTimestamp: primary.sourceTimestamp.toISOString(), feed: primary.feed };
    // Closes are matched by trading date, so a delayed intraday quote is never compared with a different day's close.
    const v = verifyQuote(
      { provider: primary.source.key, ...p, closes: quoteCloses(p, calendar) },
      { provider: secondary.descriptor.key, price: quote.price, sourceTimestamp: quote.sourceTimestamp, previousClose: quote.previousClose, closes: quoteCloses(quote, calendar) },
    );
    const note = v.comparedField
      ? `${v.comparedField}: ${primary.source.key} ${v.primary} vs ${secondary.descriptor.key} ${v.secondary} (Δ ${((v.relDiff ?? 0) * 100).toFixed(2)}%)`
      : v.note;
    await db.dataVerification.updateMany({ where: { securityId, dataset: "quote", resolvedAt: null }, data: { resolvedAt: new Date() } });
    await db.dataVerification.create({
      data: {
        securityId,
        dataset: "quote",
        metric: v.comparedField?.startsWith("close:") ? "close" : (v.comparedField ?? "price"),
        primarySource: primary.source.key,
        primaryValue: v.primary,
        primaryReference: primary.sourceTimestamp.toISOString(),
        secondarySource: secondary.descriptor.key,
        secondaryValue: v.secondary,
        secondaryReference: quote.sourceTimestamp,
        relDiff: v.relDiff,
        tolerance: 0.005,
        status: v.status,
      },
    });
    return db.quoteSnapshot.update({ where: { id: primary.id }, data: { verificationStatus: v.status, verificationNote: note }, include: { source: true } });
  } catch (e) {
    await failFetch(fetch.id, e);
    attempts.push({
      provider: secondary.descriptor.key,
      fetchId: fetch.id,
      ok: false,
      httpStatus: e instanceof ProviderError ? e.httpStatus : null,
      code: e instanceof ProviderError ? e.code : "UNKNOWN",
      error: e instanceof Error ? e.message : String(e),
      at: new Date().toISOString(),
    });
    return primary;
  }
}

async function latestStoredClose(securityId: string, calendar: ReturnType<typeof calendarForExchange>) {
  const bars = await db.priceBar.findMany({ where: { securityId }, orderBy: { date: "desc" }, take: 2, include: { source: true, fetch: true } });
  const last = bars[0];
  if (!last) return null;
  const date = last.date.toISOString().slice(0, 10);
  // A daily bar describes the session close; stamp it at that instant in exchange time.
  // (For calendars that are not modelled the placeholder close is 23:59, i.e. the end of that local day.)
  const sourceTimestamp = zonedTimeToUtc(date, sessionCloseTime(calendar, date), calendar.timezone).toISOString();
  return {
    price: Number(last.close),
    previousClose: bars[1] ? Number(bars[1].close) : null,
    currency: last.currency,
    sourceTimestamp,
    retrievedAt: (last.fetch?.completedAt ?? last.createdAt).toISOString(),
    sourceKey: last.source.key,
    sourceName: last.source.name,
  };
}

/** Values computed from stored data when the quote provider does not supply them (labelled "derived" in the UI). */
async function derivedFields(securityId: string, now: Date) {
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const [agg, shares] = await Promise.all([
    db.priceBar.aggregate({ where: { securityId, date: { gte: since } }, _max: { high: true, close: true }, _min: { low: true, close: true }, _count: true }),
    db.financialLineItem.findFirst({
      where: { concept: "sharesOutstanding", statement: { securityId } },
      orderBy: { statement: { periodEnd: "desc" } },
    }),
  ]);
  const hasYear = agg._count >= 200;
  return {
    yearHigh: hasYear ? n(agg._max.high ?? agg._max.close) : null,
    yearLow: hasYear ? n(agg._min.low ?? agg._min.close) : null,
    sharesOutstanding: shares ? Number(shares.value) : null,
  };
}
