import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { MetricCard } from "@/components/finance/metric-card";
import { LoadFixturesButton, SyncUniverseButton } from "@/components/finance/action-buttons";
import { DevFixtureBadge } from "@/components/finance/badges";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import { fmt, lookup, type Dictionary, type Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { getDataHealth } from "@/server/data-health";

export default async function DataHealthPage({ params }: PageProps<"/[locale]/data-health">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.dataHealth.title} subtitle={dict.dataHealth.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content locale={locale} dict={dict} />
      </Suspense>
    </>
  );
}

async function Content({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const h = await getDataHealth();
  const sec = h.providers.find((p) => p.key === "sec-edgar");
  const fixtures = h.providers.find((p) => p.key === "dev-fixture");
  return (
    <div className="flex flex-col gap-5">
      {h.fixtureSecurities > 0 && (
        <Alert variant="warning">
          <AlertDescription>{fmt(dict.dataHealth.fixtureWarning, { n: h.fixtureSecurities })}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <MetricCard locale={locale} label={dict.dataHealth.securities} value={h.counts.securities} format="integer" />
        <MetricCard locale={locale} label={dict.dataHealth.priceBars} value={h.counts.priceBars} format="integer" />
        <MetricCard locale={locale} label={dict.dataHealth.statements} value={h.counts.statements} format="integer" />
        <MetricCard locale={locale} label={dict.dataHealth.snapshots} value={h.counts.snapshots} format="integer" />
        <MetricCard locale={locale} label={dict.dataHealth.failures24h} value={h.failures24h} format="integer" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{dict.dataHealth.providers}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            {h.providers.map((p) => {
              const source = h.sources.find((s) => s.key === p.key);
              const lastFetch = source?.fetches[0];
              return (
                <div key={p.key} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.configured ? <CheckCircle2 className="size-4 text-positive" /> : <XCircle className="size-4 text-muted-foreground" />}
                      {p.name}
                      {p.isDevFixture && <DevFixtureBadge dict={dict} />}
                    </div>
                    <Badge variant={p.configured ? "positive" : "muted"}>{p.configured ? dict.dataHealth.configured : dict.dataHealth.notConfigured}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    <span>{dict.dataHealth.capabilities}:</span>
                    {p.capabilities.map((c) => (
                      <Badge key={c} variant="outline" className="font-normal">
                        {c}
                      </Badge>
                    ))}
                    <span className="ms-2">{dict.dataHealth.markets}:</span>
                    {p.markets.map((m) => (
                      <Badge key={m} variant="outline" className="font-normal">
                        {m}
                      </Badge>
                    ))}
                  </div>
                  {p.missingEnv.length > 0 && (
                    <div className="font-mono text-xs text-warning" dir="ltr">
                      {fmt(dict.dataHealth.missingEnv, { vars: p.missingEnv.join(", ") })}
                    </div>
                  )}
                  {lastFetch && (
                    <div className="text-xs text-muted-foreground">
                      {dict.common.lastUpdated}: {formatDate(locale, lastFetch.startedAt.toISOString(), { dateStyle: "short", timeStyle: "short" })} ·{" "}
                      {dict.dataHealth.fetchStatus[lastFetch.status]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4 border-t pt-4">
            {sec?.configured && <SyncUniverseButton />}
            {fixtures?.configured && <LoadFixturesButton />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{dict.dataHealth.recentFetches}</CardTitle>
        </CardHeader>
        <CardContent>
          {h.recentFetches.length === 0 ? (
            <EmptyState compact title={dict.dataHealth.noFetches} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dict.dataHealth.started}</TableHead>
                  <TableHead>{dict.common.source}</TableHead>
                  <TableHead>{dict.dataHealth.dataset}</TableHead>
                  <TableHead>{dict.screening.columns.security}</TableHead>
                  <TableHead>{dict.dataHealth.status}</TableHead>
                  <TableHead className="text-end">{dict.dataHealth.records}</TableHead>
                  <TableHead>{dict.dataHealth.error}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.recentFetches.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs">{formatDate(locale, f.startedAt.toISOString(), { dateStyle: "short", timeStyle: "short" })}</TableCell>
                    <TableCell className="font-mono text-xs">{f.source.key}</TableCell>
                    <TableCell className="text-xs">{f.dataset}</TableCell>
                    <TableCell>
                      {f.security ? (
                        <Link href={securityPath(locale, f.security.exchange.code, f.security.ticker)} className="font-mono text-xs hover:underline" dir="ltr">
                          {f.security.ticker}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={f.status === "SUCCESS" ? "positive" : f.status === "FAILED" ? "negative" : "warning"}>{dict.dataHealth.fetchStatus[f.status]}</Badge>
                    </TableCell>
                    <TableCell className="num text-end font-mono text-xs">{f.recordCount ?? "—"}</TableCell>
                    <TableCell className="max-w-80 truncate text-xs text-negative" title={f.errorMessage ?? ""} dir="ltr">
                      {f.errorMessage ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{dict.dataHealth.issues}</CardTitle>
        </CardHeader>
        <CardContent>
          {h.openIssues.length === 0 ? (
            <EmptyState compact title={dict.dataHealth.noIssues} />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {h.openIssues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant={i.severity === "ERROR" ? "negative" : i.severity === "WARNING" ? "warning" : "muted"}>{i.severity}</Badge>
                  {i.security && (
                    <Link href={securityPath(locale, i.security.exchange.code, i.security.ticker)} className="font-mono text-xs hover:underline" dir="ltr">
                      {i.security.ticker}
                    </Link>
                  )}
                  <span>{lookup(dict.dataHealth.issueCodes as Record<string, string>, i.code)}</span>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {i.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
