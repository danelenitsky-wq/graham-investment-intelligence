import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { AcknowledgeButton, RuleToggle, RunAlertsButtons } from "@/components/holdings/small-actions";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import { fmt, lookup, type Dictionary, type Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { getMonitoringInfo, listAlertEvents, listAlertRules } from "@/server/alerts";
import { db } from "@/server/db";

export default async function AlertsPage({ params }: PageProps<"/[locale]/alerts">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.holdings.alerts.title} subtitle={dict.holdings.alerts.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content locale={locale} dict={dict} />
      </Suspense>
    </>
  );
}

const dt = (locale: Locale, iso: string | null) => formatDate(locale, iso, { dateStyle: "medium", timeStyle: "short" });

async function Content({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  // Live data (quotes, freshness, run times) is read per request.
  await connection();
  const t = dict.holdings.alerts;
  const [info, events, rules] = await Promise.all([getMonitoringInfo(), listAlertEvents({ take: 200 }), listAlertRules()]);
  const secIds = [...new Set(events.map((e) => e.securityId).filter((x): x is string => Boolean(x)))];
  const secs = new Map((await db.security.findMany({ where: { id: { in: secIds } }, include: { exchange: true } })).map((s) => [s.id, s]));
  const unread = events.filter((e) => !e.acknowledgedAt).length;
  const m = t.monitoring;
  const last = info.lastRun;
  const message = (code: string, params: unknown) => {
    const p = (params ?? {}) as Record<string, string | number>;
    const out: Record<string, string | number> = { ...p };
    if (typeof p.strategy === "string") out.strategy = dict.decision.strategies[p.strategy as keyof typeof dict.decision.strategies] ?? p.strategy;
    if (typeof p.quoteStatus === "string") out.quoteStatus = lookup(dict.market.status as Record<string, string>, p.quoteStatus);
    if (typeof p.fundamentalsStatus === "string") out.fundamentalsStatus = lookup(dict.market.status as Record<string, string>, p.fundamentalsStatus);
    return fmt(lookup(t.messages as Record<string, string>, code), out);
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{m.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <Alert variant={info.status === "ACTIVE" ? "info" : "warning"} data-testid="monitoring-status" data-status={info.status}>
            <AlertDescription>{fmt(m[info.status], { time: dt(locale, info.lastScheduledRunAt) })}</AlertDescription>
          </Alert>
          {info.status !== "ACTIVE" && <p className="text-xs text-muted-foreground">{m.howTo}</p>}
          {last && (
            <p className="text-xs text-muted-foreground">
              {fmt(m.lastRun, { time: dt(locale, last.completedAt ?? last.startedAt), trigger: m.triggers[last.trigger as keyof typeof m.triggers] ?? last.trigger, checked: last.checked, newEvents: last.newEvents, duplicates: last.duplicates, providerCalls: last.providerCalls })}
            </p>
          )}
          <RunAlertsButtons />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>
            {t.history} {unread > 0 && <Badge variant="warning">{unread}</Badge>}
          </CardTitle>
          {unread > 0 && <AcknowledgeButton id={null} />}
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState compact title={t.empty} />
          ) : (
            <Table data-testid="alert-history">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.time}</TableHead>
                  <TableHead>{t.columns.security}</TableHead>
                  <TableHead>{t.columns.type}</TableHead>
                  <TableHead>{t.columns.message}</TableHead>
                  <TableHead>{t.columns.severity}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => {
                  const s = e.securityId ? secs.get(e.securityId) : null;
                  return (
                    <TableRow key={e.id} data-type={e.type} className={e.acknowledgedAt ? "opacity-70" : undefined}>
                      <TableCell className="text-xs">{dt(locale, e.triggeredAt.toISOString())}</TableCell>
                      <TableCell>
                        {s ? (
                          <Link href={securityPath(locale, s.exchange.code, s.ticker)} className="font-mono text-xs font-semibold hover:underline" dir="ltr">
                            {s.ticker}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{t.types[e.type]}</TableCell>
                      <TableCell className="max-w-xl text-xs whitespace-normal">{message(e.message, e.params)}</TableCell>
                      <TableCell>
                        <Badge variant={e.severity === "CRITICAL" ? "negative" : e.severity === "WARNING" ? "warning" : "info"}>{t.severity[e.severity]}</Badge>
                      </TableCell>
                      <TableCell>{!e.acknowledgedAt ? <AcknowledgeButton id={e.id} /> : null}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.rules}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t.rulesNote}</p>
          {rules.length === 0 ? (
            <EmptyState compact title={t.empty} />
          ) : (
            <Table data-testid="alert-rules">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.security}</TableHead>
                  <TableHead>{t.columns.rule}</TableHead>
                  <TableHead>{t.columns.state}</TableHead>
                  <TableHead>{t.lastEvaluated}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => {
                  const skipped = r.note?.startsWith("skipped: ") ? r.note.slice(9) : null;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs" dir="ltr">
                        {r.security?.ticker}
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.types[r.type]}
                        {r.threshold !== null && (
                          <span className="ms-1 font-mono text-muted-foreground" dir="ltr">
                            ({r.type === "MARGIN_OF_SAFETY_TARGET" ? `${Math.round(Number(r.threshold) * 1000) / 10}%` : `${Number(r.threshold)} ${(r.params as { currency?: string } | null)?.currency ?? ""}`})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "ACTIVE" ? "positive" : "muted"}>{r.status === "ACTIVE" ? t.active : t.disabled}</Badge>
                      </TableCell>
                      <TableCell className="text-xs whitespace-normal">
                        {dt(locale, r.lastEvaluatedAt?.toISOString() ?? null)}
                        {skipped && <span className="block text-[11px] text-muted-foreground">{fmt(t.skippedNote, { reason: lookup(t.skipReasons as Record<string, string>, skipped) })}</span>}
                      </TableCell>
                      <TableCell>
                        <RuleToggle id={r.id} active={r.status === "ACTIVE"} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
