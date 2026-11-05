import { ExternalLink, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InsufficientDataBanner, QuoteStatusBadge, VerificationBadge } from "@/components/finance/badges";
import { Num } from "@/components/finance/num";
import { formatCompact, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { fmt, lookup, type Dictionary, type Locale } from "@/lib/i18n";
import { CONCEPTS, type CanonicalConcept } from "@/lib/normalization/concepts";
import type { VerificationStatus } from "@/lib/verification";
import type { SecurityAnalysis } from "@/server/analysis";

function fieldLabel(dict: Dictionary, field: string) {
  if (field.startsWith("concept:")) return lookup(dict.concepts as Record<string, string>, field.slice(8));
  return lookup(dict.health.fields as Record<string, string>, field);
}

/** Per-security data health: timestamps, gaps, staleness, conflicts and provider state. */
export function DataHealthPanel({ a, dict, locale }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale }) {
  const h = a.health;
  const tz = a.quote.timezone;
  const ts = (iso: string | null) => formatDate(locale, iso, { dateStyle: "medium", timeStyle: "long", timeZone: tz });
  const v = h.verification;
  const lists: [string, string[]][] = [
    [dict.health.missing, h.gate.missing.map((f) => fieldLabel(dict, f))],
    [dict.health.stale, h.gate.stale.map((f) => fieldLabel(dict, f))],
    [dict.health.conflicting, h.gate.conflicting.map((c) => lookup(dict.concepts as Record<string, string>, c.split(" ")[0]) + c.slice(c.split(" ")[0].length))],
  ];
  return (
    <Card data-testid="data-health-panel">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {dict.health.title}
          {h.gate.sufficient ? (
            <Badge variant="positive">
              <ShieldCheck /> {dict.health.sufficient}
            </Badge>
          ) : (
            <Badge variant="negative">{dict.health.insufficient}</Badge>
          )}
        </CardTitle>
        <CardDescription>{dict.health.apiRecencyNote}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!h.gate.sufficient && <InsufficientDataBanner dict={dict} />}
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{dict.health.latestQuote}</dt>
            <dd className="mt-1 flex flex-col gap-1">
              <bdi dir="ltr">{ts(h.latestQuoteTimestamp)}</bdi>
              <span>
                <QuoteStatusBadge status={a.quote.status} dict={dict} />
              </span>
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{dict.health.latestFiling}</dt>
            <dd className="mt-1 flex flex-col gap-1">
              <span>
                {h.latestFiling?.form && <span className="me-1 font-mono">{h.latestFiling.form}</span>}
                {formatDate(locale, h.latestFiling?.filingDate)}
              </span>
              {h.latestFiling?.url && (
                <a href={h.latestFiling.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs hover:underline" dir="ltr">
                  {h.latestFiling.accessionNumber} <ExternalLink className="size-3" />
                </a>
              )}
              <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" data-testid="statements-status">
                {dict.health.statementsStatus}: <QuoteStatusBadge status={h.fundamentalsStatus.status} dict={dict} />
              </span>
              <span className="text-xs text-muted-foreground">
                {dict.health.lastFilingCheck}: <bdi dir="ltr">{ts(h.lastFilingCheckAt)}</bdi>
              </span>
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{dict.health.lastRefresh}</dt>
            <dd className="mt-1">
              <bdi dir="ltr">{ts(h.lastSuccessfulRefreshAt)}</bdi>
            </dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{dict.health.verificationTitle}</dt>
            <dd className="mt-1 text-xs">
              {v.lastCheckedAt
                ? fmt(dict.health.verificationSummary, { verified: v.verified, conflict: v.conflict, single: v.singleSource, date: formatDate(locale, v.lastCheckedAt), source: v.source ?? "—" })
                : dict.health.verificationNone}
            </dd>
          </div>
        </dl>

        {h.newerFiling && (
          <p className="text-sm text-warning">{fmt(dict.health.newerFiling, { form: h.newerFiling.form, date: formatDate(locale, h.newerFiling.filedAt) })}</p>
        )}
        {h.gate.notes.includes("DEV_FIXTURE") && <p className="text-sm text-warning">{dict.health.devFixture}</p>}

        <div className="grid gap-3 md:grid-cols-3">
          {lists.map(([title, items]) => (
            <div key={title} className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground">{title}</div>
              {items.length === 0 ? (
                <div className="mt-1 text-sm">{dict.health.none}</div>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {items.map((x) => (
                    <li key={x}>
                      <Badge variant="warning" className="font-normal">
                        {x}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {h.conflicts.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">{dict.health.conflicting}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dict.health.metric}</TableHead>
                  <TableHead>{dict.health.period}</TableHead>
                  <TableHead className="text-end">{dict.health.primary}</TableHead>
                  <TableHead className="text-end">{dict.health.secondary}</TableHead>
                  <TableHead className="text-end">{dict.health.difference}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.conflicts.map((c, i) => {
                  const unit = CONCEPTS[c.metric as CanonicalConcept]?.unit;
                  const f = (x: number | null) => (unit === "perShare" || c.dataset === "quote" ? formatNumber(locale, x, 2) : formatCompact(locale, x));
                  return (
                    <TableRow key={i}>
                      <TableCell>{lookup(dict.concepts as Record<string, string>, c.metric)}</TableCell>
                      <TableCell className="font-mono text-xs">{c.fiscalYear ? `FY${c.fiscalYear} ${c.fiscalPeriod ?? ""}` : c.dataset}</TableCell>
                      <TableCell className="text-end">
                        <Num>{f(c.primaryValue)}</Num> <span className="text-xs text-muted-foreground">{c.primarySource}</span>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num>{f(c.secondaryValue)}</Num> <span className="text-xs text-muted-foreground">{c.secondarySource}</span>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num tone="negative">{formatPercent(locale, c.relDiff, 2)}</Num>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-medium">{dict.health.providerStatus}</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {h.providers.map((p) => (
              <div key={p.key} className="flex flex-col gap-1 rounded-lg border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge variant={p.state === "OK" ? "positive" : p.state === "DEGRADED" ? "warning" : p.state === "DOWN" ? "negative" : "muted"}>
                    {dict.health.providerStates[p.state]}
                  </Badge>
                </div>
                {p.missingEnv.length > 0 && (
                  <span className="font-mono text-warning" dir="ltr">
                    {fmt(dict.dataHealth.missingEnv, { vars: p.missingEnv.join(", ") })}
                  </span>
                )}
                {p.lastSuccessAt && (
                  <span className="text-muted-foreground">
                    {dict.health.lastSuccess}: <bdi dir="ltr">{ts(p.lastSuccessAt)}</bdi>
                  </span>
                )}
                {p.lastFailureAt && (
                  <span className="text-muted-foreground">
                    {dict.health.lastFailure}: <bdi dir="ltr">{ts(p.lastFailureAt)}</bdi>
                    {p.consecutiveFailures > 0 && ` · ${fmt(dict.health.consecutiveFailures, { n: p.consecutiveFailures })}`}
                  </span>
                )}
                {p.lastError && p.consecutiveFailures > 0 && (
                  <span className="break-words text-negative" dir="ltr">
                    {p.lastError}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Quarterly statements as reported in 10-Q filings, with filing references. */
export function QuarterlyTable({ a, dict, locale }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale }) {
  if (a.quarterly.length === 0) return null;
  const concepts: CanonicalConcept[] = ["revenue", "netIncome", "epsDiluted", "totalAssets", "currentAssets", "currentLiabilities", "stockholdersEquity", "operatingCashFlow"];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.health.quarterly}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{dict.health.period}</TableHead>
              {concepts.map((c) => (
                <TableHead key={c} className="text-end">
                  {lookup(dict.concepts as Record<string, string>, c)}
                </TableHead>
              ))}
              <TableHead>{dict.common.filed}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {a.quarterly.map((q) => (
              <TableRow key={q.periodEnd}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  FY{q.fiscalYear} {q.fiscalPeriod} <span className="text-muted-foreground">({formatDate(locale, q.periodEnd)})</span>
                </TableCell>
                {concepts.map((c) => (
                  <TableCell key={c} className="text-end">
                    <Num>{CONCEPTS[c].unit === "perShare" ? formatNumber(locale, q.values[c], 2) : formatCompact(locale, q.values[c])}</Num>
                  </TableCell>
                ))}
                <TableCell className="text-xs whitespace-nowrap">
                  {q.form} {formatDate(locale, q.filedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function VerificationCell({ status, dict }: { status: string | undefined; dict: Dictionary }) {
  return <VerificationBadge status={(status ?? "UNVERIFIED") as VerificationStatus} dict={dict} />;
}
