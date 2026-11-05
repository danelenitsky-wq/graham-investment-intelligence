"use client";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { QuoteStatusBadge, VerificationBadge } from "@/components/finance/badges";
import { Num, signTone } from "@/components/finance/num";
import { useI18n } from "@/components/layout/providers";
import { formatCompact, formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { fmt, lookup } from "@/lib/i18n";
import type { QuoteView } from "@/server/quotes";

/** Instant formatted in the exchange's own timezone, with its abbreviation. */
function exchangeTime(locale: string, iso: string | null, tz: string) {
  return formatDate(locale, iso, { dateStyle: "medium", timeStyle: "long", timeZone: tz });
}

/**
 * Latest quote with its freshness status. Fetched on the server when the page
 * opens; refreshed every 60 s while the market is open when the configured
 * provider plan supports it; "Refresh now" always issues a new provider request.
 */
export function LiveQuote({ initial }: { initial: QuoteView }) {
  const { dict, locale } = useI18n();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(initial.autoRefreshSeconds);
  const lastTimestamp = useRef(initial.sourceTimestamp);

  const apply = useCallback(
    (next: QuoteView, manual: boolean) => {
      setView(next);
      if (manual) {
        const failed = next.attempts.find((a) => !a.ok);
        const ok = next.attempts.find((a) => a.ok);
        if (next.decision === "FORCE_THROTTLED") setMessage({ tone: "error", text: dict.market.throttled });
        else if (ok) setMessage({ tone: "ok", text: fmt(dict.market.requestOk, { provider: ok.provider, time: exchangeTime(locale, ok.at, next.timezone) }) });
        else if (failed) setMessage({ tone: "error", text: fmt(dict.market.requestFailed, { provider: failed.provider, error: failed.error ?? failed.code ?? "" }) });
      }
      // A new price changes valuation outputs: re-render the server analysis with it.
      if (next.sourceTimestamp !== lastTimestamp.current) {
        lastTimestamp.current = next.sourceTimestamp;
        router.refresh();
      }
    },
    [dict, locale, router],
  );

  const load = useCallback(
    async (force: boolean) => {
      const res = await fetch(`/api/quote/${view.securityId}`, { method: force ? "POST" : "GET", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as QuoteView;
    },
    [view.securityId],
  );

  const refreshNow = async () => {
    setPending(true);
    setMessage(null);
    try {
      apply(await load(true), true);
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPending(false);
    }
  };

  // 60 s auto refresh (only when the provider plan supports it and the market is not closed).
  useEffect(() => {
    const every = view.autoRefreshSeconds;
    if (!every) return;
    let remaining = every;
    const timer = setInterval(async () => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = every;
        if (document.visibilityState === "visible") {
          try {
            apply(await load(false), false);
          } catch {
            /* the next poll retries; the server keeps the last verified value */
          }
        }
      }
      setCountdown(remaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [view.autoRefreshSeconds, load, apply]);

  // While closed, wake up at the next open so polling resumes by itself.
  useEffect(() => {
    if (view.autoRefreshSeconds || view.session.state !== "CLOSED" || !view.session.nextOpen || view.configuredProviders.length === 0) return;
    const ms = Date.parse(view.session.nextOpen) - Date.now() + 5_000;
    if (ms <= 0 || ms > 2 ** 31 - 1) return;
    const t = setTimeout(async () => apply(await load(false), false), ms);
    return () => clearTimeout(t);
  }, [view.autoRefreshSeconds, view.session, view.configuredProviders.length, load, apply]);

  const s = view.session;
  const offReason = view.configuredProviders.length === 0 ? "none" : s.state === "CLOSED" ? "closed" : "plan";
  return (
    <div className="flex flex-col gap-2 lg:items-end" data-testid="live-quote">
      <div className="flex flex-wrap items-baseline gap-3">
        <Num className="text-3xl font-semibold">{formatCurrency(locale, view.price, view.currency)}</Num>
        {view.change !== null && (
          <Num tone={signTone(view.change)}>
            {`${view.change > 0 ? "+" : ""}${formatCurrency(locale, view.change, view.currency)} (${view.changePercent !== null ? (view.changePercent > 0 ? "+" : "") + formatPercent(locale, view.changePercent, 2) : "—"})`}
          </Num>
        )}
        <QuoteStatusBadge status={view.status} dict={dict} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground lg:text-end">
        <dt>{dict.market.quoteTime}</dt>
        <dd data-testid="quote-source-timestamp">
          <bdi dir="ltr">{exchangeTime(locale, view.sourceTimestamp, view.timezone)}</bdi>
        </dd>
        <dt>{dict.market.retrievedAt}</dt>
        <dd>
          <bdi dir="ltr">{exchangeTime(locale, view.retrievedAt, view.timezone)}</bdi> · {dict.market.servedFrom[view.servedFrom]}
        </dd>
        <dt>{dict.market.provider}</dt>
        <dd>
          <span className="font-mono">{view.provider?.key ?? "—"}</span>
          {view.feed && ` · ${dict.market.feeds[view.feed]}`}
          {view.feedNote && ` · ${lookup(dict.market.feedNotes as Record<string, string>, view.feedNote)}`}
        </dd>
        <dt>{dict.market.marketCap}</dt>
        <dd>
          <Num>{formatCompact(locale, view.marketCap, view.currency)}</Num>
          {view.marketCapDerived && <span className="ms-1">({dict.market.derived})</span>}
        </dd>
        <dt>{dict.market.range52w}</dt>
        <dd>
          <Num>{`${formatCurrency(locale, view.yearLow, view.currency)} – ${formatCurrency(locale, view.yearHigh, view.currency)}`}</Num>
          {view.yearRangeDerived && <span className="ms-1">({dict.market.derived})</span>}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
        <span>
          {dict.market.session[s.state]}
          {s.closedReason && ` (${dict.market.closedReasons[s.closedReason]}${s.holidayName ? `: ${s.holidayName}` : ""})`}
          {s.earlyClose && ` · ${dict.market.earlyClose}`}
          {s.state === "CLOSED" && s.nextOpen && ` · ${fmt(dict.market.nextOpen, { time: exchangeTime(locale, s.nextOpen, view.timezone) })}`}
        </span>
        <VerificationBadge status={view.verification.status} dict={dict} />
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <span className="text-xs text-muted-foreground" data-testid="auto-refresh">
          {view.autoRefreshSeconds
            ? fmt(dict.market.autoRefresh, { n: view.autoRefreshSeconds, s: countdown ?? view.autoRefreshSeconds })
            : fmt(dict.market.autoRefreshOff, { reason: dict.market.autoRefreshReasons[offReason] })}
        </span>
        <Button size="sm" variant="outline" onClick={refreshNow} disabled={pending} data-testid="refresh-now">
          {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {pending ? dict.market.refreshing : dict.market.refreshNow}
        </Button>
      </div>
      {view.configuredProviders.length === 0 && <p className="max-w-md text-xs text-warning">{dict.market.noProvider}</p>}
      {message && (
        <p className={message.tone === "ok" ? "max-w-md text-xs text-muted-foreground" : "max-w-md text-xs break-words text-negative"} data-testid="refresh-message">
          {message.text}
        </p>
      )}
    </div>
  );
}
