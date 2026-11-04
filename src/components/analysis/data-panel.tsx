import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DevFixtureBadge, FreshnessBadge } from "@/components/finance/badges";
import { EmptyState } from "@/components/finance/states";
import { DataHealthPanel, QuarterlyTable, VerificationCell } from "@/components/analysis/data-health-panel";
import { summarizeVerification, type VerificationStatus } from "@/lib/verification";
import { formatDate } from "@/lib/format";
import { fmt, lookup, type Dictionary, type Locale } from "@/lib/i18n";
import type { SecurityAnalysis } from "@/server/analysis";

export function DataPanel({ a, dict, locale }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale }) {
  const f = a.freshness;
  const issueText = (code: string) => lookup(dict.dataHealth.issueCodes as Record<string, string>, code);
  return (
    <div className="flex flex-col gap-5">
      <DataHealthPanel a={a} dict={dict} locale={locale} />
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ["prices", dict.stock.price],
          ["fundamentals", dict.nav.financials],
        ] as const).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between rounded-xl border bg-card p-4">
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-muted-foreground">
                {dict.common.asOf} {formatDate(locale, f[k].asOf)}
                {f[k].ageDays !== null && ` · ${fmt(dict.common.daysAgo, { n: f[k].ageDays! })}`}
              </div>
            </div>
            <div className="flex gap-1">
              {f[k].isDevFixture && <DevFixtureBadge dict={dict} />}
              <FreshnessBadge level={f[k].level} dict={dict} />
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{dict.common.source}</CardTitle>
        </CardHeader>
        <CardContent>
          {a.provenance.length === 0 ? (
            <EmptyState compact title={dict.stock.noFundamentals} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dict.common.fiscalYear}</TableHead>
                  <TableHead>{dict.common.source}</TableHead>
                  <TableHead>{dict.common.form}</TableHead>
                  <TableHead>{dict.common.accession}</TableHead>
                  <TableHead>{dict.common.filed}</TableHead>
                  <TableHead>{dict.health.retrieved}</TableHead>
                  <TableHead>{dict.health.verificationCol}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...a.provenance].reverse().map((p) => (
                  <TableRow key={p.periodEnd}>
                    <TableCell className="num font-mono">{p.fiscalYear}</TableCell>
                    <TableCell>
                      {p.sourceName} {p.isDevFixture && <DevFixtureBadge dict={dict} />}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.form ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {p.filingUrl ? (
                        <a href={p.filingUrl} target="_blank" rel="noreferrer" className="hover:underline">
                          {p.accessionNumber}
                        </a>
                      ) : (
                        (p.accessionNumber ?? "—")
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{formatDate(locale, p.filedAt)}</TableCell>
                    <TableCell className="text-xs">{formatDate(locale, p.retrievedAt, { dateStyle: "short", timeStyle: "short", timeZone: a.quote.timezone })}</TableCell>
                    <TableCell>
                      <VerificationCell
                        status={summarizeVerification(Object.values(p.verification).map((x) => ({ status: x as VerificationStatus })).filter((x) => x.status !== "UNVERIFIED"))}
                        dict={dict}
                      />
                    </TableCell>
                    <TableCell>{p.isRestated && <Badge variant="warning">{dict.financials.restated}</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <QuarterlyTable a={a} dict={dict} locale={locale} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{dict.dataHealth.issues}</CardTitle>
          </CardHeader>
          <CardContent>
            {f.issues.length + a.issues.length === 0 ? (
              <EmptyState compact title={dict.dataHealth.noIssues} />
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {a.issues.map((i, n) => (
                  <li key={`s${n}`} className="flex items-start gap-2">
                    <Badge variant={i.severity === "ERROR" ? "negative" : i.severity === "WARNING" ? "warning" : "muted"}>{i.severity}</Badge>
                    <span>{issueText(i.code)}</span>
                  </li>
                ))}
                {f.issues.map((i, n) => (
                  <li key={`v${n}`} className="flex items-start gap-2">
                    <Badge variant={i.severity === "ERROR" ? "negative" : i.severity === "WARNING" ? "warning" : "muted"}>{i.severity}</Badge>
                    <span>
                      {issueText(i.code)}
                      {i.fiscalYear ? <span className="num ms-1 font-mono text-muted-foreground">FY{i.fiscalYear}</span> : null}
                      {i.code === "MISSING_CONCEPT" && i.context?.concept ? (
                        <span className="ms-1 text-muted-foreground">({lookup(dict.concepts as Record<string, string>, String(i.context.concept))})</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{dict.dataHealth.recentFetches}</CardTitle>
          </CardHeader>
          <CardContent>
            {a.fetches.length === 0 ? (
              <EmptyState compact title={dict.dataHealth.noFetches} />
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {a.fetches.map((x, n) => (
                  <li key={n} className="flex flex-wrap items-center gap-2">
                    <Badge variant={x.status === "SUCCESS" ? "positive" : x.status === "FAILED" ? "negative" : "warning"}>
                      {dict.dataHealth.fetchStatus[x.status as keyof typeof dict.dataHealth.fetchStatus] ?? x.status}
                    </Badge>
                    <span className="font-mono text-xs">{x.sourceKey}</span>
                    <span className="text-xs text-muted-foreground">{x.dataset}</span>
                    <span className="ms-auto text-xs text-muted-foreground">{formatDate(locale, x.startedAt, { dateStyle: "short", timeStyle: "short" })}</span>
                    {x.errorMessage && <span className="w-full text-xs break-words text-negative" dir="ltr">{x.errorMessage}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
