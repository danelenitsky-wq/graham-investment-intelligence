/**
 * Quote freshness engine (pure).
 *
 * Status vocabulary shown to the user:
 * - FRESH       provider-confirmed real-time feed, market open, quote ≤ liveMaxAgeSeconds old
 * - DELAYED     market open, quote within the feed's documented delay (or feed not confirmed real-time)
 * - LAST_CLOSE  market closed (or just opened) and the quote belongs to the most recent session close
 * - CACHED      the latest provider request failed; showing the last verified value, still recent
 * - STALE       older than the above windows allow, or its timestamp cannot be trusted
 * - UNAVAILABLE no quote has ever been retrieved
 * - CONFLICTED  an independent provider disagrees with this value beyond tolerance
 *
 * A quote is never FRESH unless its feed is REALTIME, which adapters set only
 * when the provider documents real-time delivery for the configured plan. None
 * of the free plans used by default is documented that way, so with the
 * free-first setup the best intraday status is DELAYED.
 */
import { localParts, type SessionInfo } from "@/lib/market/calendar";

export type QuoteFeed = "REALTIME" | "DELAYED" | "EOD" | "UNKNOWN";
export type QuoteStatus = "FRESH" | "DELAYED" | "LAST_CLOSE" | "CACHED" | "STALE" | "UNAVAILABLE" | "CONFLICTED";

export interface QuoteObservation {
  price: number;
  /** When the provider says the price was traded / quoted (ISO instant). */
  sourceTimestamp: string;
  /** When we received it from the provider (ISO instant). */
  retrievedAt: string;
  feed: QuoteFeed;
  /** Documented delay of a DELAYED feed, minutes. */
  delayMinutes?: number | null;
}

export interface QuoteThresholds {
  liveMaxAgeSeconds: number;
  /** Delay assumed for DELAYED/UNKNOWN feeds without a documented delay. */
  defaultDelayMinutes: number;
  /** Extra slack on top of the delay before a quote is stale (thin trading). */
  delayedGraceMinutes: number;
  /** A quote this close to the session close counts as the closing quote. */
  closeToleranceMinutes: number;
  /** How long after the open the previous close is still an acceptable "last close". */
  openingGraceMinutes: number;
  /** Cached (provider failed) values older than this are STALE. */
  cachedMaxAgeMinutes: number;
  /** Future timestamps beyond this skew are rejected as untrustworthy. */
  maxClockSkewSeconds: number;
}

export const DEFAULT_QUOTE_THRESHOLDS: QuoteThresholds = {
  liveMaxAgeSeconds: 120,
  defaultDelayMinutes: 15,
  delayedGraceMinutes: 10,
  closeToleranceMinutes: 20,
  openingGraceMinutes: 15,
  cachedMaxAgeMinutes: 20,
  maxClockSkewSeconds: 300,
};

export type QuoteReason =
  | "NO_QUOTE"
  | "FUTURE_TIMESTAMP"
  | "REALTIME_FRESH"
  | "WITHIN_DELAY"
  | "FEED_NOT_CONFIRMED_REALTIME"
  | "OLDER_THAN_DELAY"
  | "LAST_SESSION_CLOSE"
  | "PREVIOUS_CLOSE_AT_OPEN"
  | "NOT_LAST_SESSION"
  | "CALENDAR_UNKNOWN"
  | "PROVIDER_FAILED_USING_CACHE"
  | "CACHE_TOO_OLD"
  | "CROSS_CHECK_CONFLICT";

export interface QuoteClassification {
  status: QuoteStatus;
  /** Status before any cache downgrade. */
  baseStatus: QuoteStatus;
  reasons: QuoteReason[];
  ageSeconds: number | null;
}

export interface ClassifyInput {
  quote: QuoteObservation | null;
  session: SessionInfo;
  now: Date;
  /** The most recent provider request for this quote failed. */
  lastFetchFailed: boolean;
  /** An independent provider disagreed with this value (open CONFLICT). */
  conflicted?: boolean;
  thresholds?: QuoteThresholds;
}

export function classifyQuote(input: ClassifyInput): QuoteClassification {
  const c = classifyQuoteTime(input);
  // A conflict outranks every time-based status except a missing quote: the value itself is in doubt.
  if (input.conflicted && c.status !== "UNAVAILABLE") return { ...c, status: "CONFLICTED", reasons: [...c.reasons, "CROSS_CHECK_CONFLICT"] };
  return c;
}

function classifyQuoteTime({ quote, session, now, lastFetchFailed, thresholds = DEFAULT_QUOTE_THRESHOLDS }: ClassifyInput): QuoteClassification {
  if (!quote) return { status: "UNAVAILABLE", baseStatus: "UNAVAILABLE", reasons: ["NO_QUOTE"], ageSeconds: null };
  const ts = Date.parse(quote.sourceTimestamp);
  const ageSeconds = Math.round((now.getTime() - ts) / 1000);
  if (!Number.isFinite(ts) || ageSeconds < -thresholds.maxClockSkewSeconds) {
    return { status: "STALE", baseStatus: "STALE", reasons: ["FUTURE_TIMESTAMP"], ageSeconds };
  }
  const age = Math.max(0, ageSeconds);
  const reasons: QuoteReason[] = [];
  const delayWindow = ((quote.delayMinutes ?? thresholds.defaultDelayMinutes) + thresholds.delayedGraceMinutes) * 60;

  const isLastSessionQuote = () => {
    if (!session.lastSessionDate || !session.lastSessionClose) return false;
    const quoteLocalDate = localParts(new Date(ts), session.timezone).date;
    if (quoteLocalDate !== session.lastSessionDate) return false;
    return ts >= Date.parse(session.lastSessionClose) - thresholds.closeToleranceMinutes * 60_000;
  };

  let base: QuoteStatus;
  if (session.state === "UNKNOWN") {
    // Without a trustworthy calendar we cannot say "live" or "official close".
    reasons.push("CALENDAR_UNKNOWN");
    base = quote.feed !== "EOD" && age <= delayWindow ? "DELAYED" : "STALE";
  } else if (session.state === "OPEN") {
    if (quote.feed === "REALTIME" && age <= thresholds.liveMaxAgeSeconds) {
      base = "FRESH";
      reasons.push("REALTIME_FRESH");
    } else if (quote.feed !== "EOD" && age <= delayWindow) {
      base = "DELAYED";
      reasons.push(quote.feed === "REALTIME" ? "OLDER_THAN_DELAY" : quote.feed === "DELAYED" ? "WITHIN_DELAY" : "FEED_NOT_CONFIRMED_REALTIME");
    } else if (
      isLastSessionQuote() &&
      session.sessionOpen &&
      now.getTime() - Date.parse(session.sessionOpen) <= thresholds.openingGraceMinutes * 60_000
    ) {
      base = "LAST_CLOSE";
      reasons.push("PREVIOUS_CLOSE_AT_OPEN");
    } else if (quote.feed === "EOD" && isLastSessionQuote()) {
      // An end-of-day feed during the session can only ever show the previous close.
      base = "LAST_CLOSE";
      reasons.push("LAST_SESSION_CLOSE");
    } else {
      base = "STALE";
      reasons.push(quote.feed === "EOD" ? "NOT_LAST_SESSION" : "OLDER_THAN_DELAY");
    }
  } else {
    if (isLastSessionQuote()) {
      base = "LAST_CLOSE";
      reasons.push("LAST_SESSION_CLOSE");
    } else {
      base = "STALE";
      reasons.push("NOT_LAST_SESSION");
    }
  }

  if (lastFetchFailed && base !== "STALE") {
    const retrievedAge = (now.getTime() - Date.parse(quote.retrievedAt)) / 60_000;
    // A last close stays valid until the next session, so it is only "cached", never stale, while closed.
    if (base === "LAST_CLOSE" || retrievedAge <= thresholds.cachedMaxAgeMinutes) {
      return { status: "CACHED", baseStatus: base, reasons: [...reasons, "PROVIDER_FAILED_USING_CACHE"], ageSeconds };
    }
    return { status: "STALE", baseStatus: base, reasons: [...reasons, "CACHE_TOO_OLD"], ageSeconds };
  }
  return { status: base, baseStatus: base, reasons, ageSeconds };
}

/** Statuses good enough to feed downstream analysis. */
export function isUsableQuoteStatus(s: QuoteStatus): boolean {
  return s === "FRESH" || s === "DELAYED" || s === "LAST_CLOSE" || s === "CACHED";
}

// ─────────────────────────────── Cache policy ───────────────────────────────

export interface CachePolicy {
  /** Max age of a cached provider response while the market is open. */
  openTtlSeconds: number;
  /** Max age while closed (nothing should change, but corrections happen). */
  closedTtlSeconds: number;
  /** After a failed request, wait this long before trying again automatically. */
  failureBackoffSeconds: number;
  /** Refresh Now spam guard. */
  minForcedIntervalSeconds: number;
}

export const DEFAULT_CACHE_POLICY: CachePolicy = {
  openTtlSeconds: 55, // a 60 s poll always finds the cache expired
  closedTtlSeconds: 30 * 60,
  failureBackoffSeconds: 30,
  minForcedIntervalSeconds: 2,
};

export type FetchDecisionReason =
  | "FORCED"
  | "FORCE_THROTTLED"
  | "NO_CACHE"
  | "TTL_EXPIRED"
  | "SESSION_CHANGED"
  | "FAILURE_BACKOFF"
  | "CACHE_FRESH"
  | "NO_PROVIDER";

export interface CacheEntryMeta {
  retrievedAt: string;
  /** Session state + local date when the cached value was fetched. */
  sessionState: SessionInfo["state"];
  sessionDate: string;
}

export interface FetchDecision {
  fetch: boolean;
  reason: FetchDecisionReason;
}

export function decideQuoteFetch(input: {
  cached: CacheEntryMeta | null;
  lastAttempt: { at: string; failed: boolean } | null;
  session: SessionInfo;
  now: Date;
  force: boolean;
  hasProvider: boolean;
  policy?: CachePolicy;
}): FetchDecision {
  const { cached, lastAttempt, session, now, force, hasProvider, policy = DEFAULT_CACHE_POLICY } = input;
  if (!hasProvider) return { fetch: false, reason: "NO_PROVIDER" };
  const since = (iso: string) => (now.getTime() - Date.parse(iso)) / 1000;
  if (force) {
    if (lastAttempt && since(lastAttempt.at) < policy.minForcedIntervalSeconds) return { fetch: false, reason: "FORCE_THROTTLED" };
    return { fetch: true, reason: "FORCED" };
  }
  if (lastAttempt?.failed && since(lastAttempt.at) < policy.failureBackoffSeconds) return { fetch: false, reason: "FAILURE_BACKOFF" };
  if (!cached) return { fetch: true, reason: "NO_CACHE" };
  // Invalidate across session boundaries: a value fetched while open must not be served after the close, and vice versa.
  if (cached.sessionState !== session.state || cached.sessionDate !== session.localDate) return { fetch: true, reason: "SESSION_CHANGED" };
  const ttl = session.state === "OPEN" ? policy.openTtlSeconds : policy.closedTtlSeconds;
  if (since(cached.retrievedAt) >= ttl) return { fetch: true, reason: "TTL_EXPIRED" };
  return { fetch: false, reason: "CACHE_FRESH" };
}
