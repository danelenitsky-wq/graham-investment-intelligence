import { TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Num, signTone } from "@/components/finance/num";
import { formatCompact, formatDate, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import type { DeteriorationFlag, InterimHealth, InterimMetric } from "@/lib/interim";

function formatMetric(locale: Locale, metric: InterimMetric, v: number | null) {
  if (metric === "epsDiluted") return formatNumber(locale, v, 2);
  if (metric === "currentRatio") return formatRatio(locale, v, 2);
  return formatCompact(locale, v);
}

export function flagText(dict: Dictionary, locale: Locale, f: DeteriorationFlag) {
  const threshold = f.code === "CURRENT_RATIO_BELOW_REFERENCE" ? formatNumber(locale, f.threshold, 1) : formatPercent(locale, f.threshold, 0);
  return fmt(dict.interim.flags[f.code], { change: formatPercent(locale, f.change === null ? null : Math.abs(f.change), 1), threshold });
}

/** Banner for the summary tab: shown only when later quarterly filings show material deterioration. */
export function InterimDeteriorationBanner({ interim, dict }: { interim: InterimHealth; dict: Dictionary }) {
  if (!interim.materialDeterioration || !interim.latestAnnual) return null;
  return (
    <div role="alert" data-testid="interim-deterioration" className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>
        <div className="font-semibold tracking-wide">{dict.interim.bannerTitle}</div>
        <div className="text-foreground/80">{fmt(dict.interim.bannerBody, { count: interim.flags.length, year: interim.latestAnnual.fiscalYear })}</div>
      </div>
    </div>
  );
}

/** Latest-quarter and TTM view, clearly separate from the annual Graham analysis. */
export function InterimPanel({ interim, dict, locale }: { interim: InterimHealth; dict: Dictionary; locale: Locale }) {
  const t = dict.interim;
  const q = interim.latestQuarter;
  return (
    <div className="flex flex-col gap-4" data-testid="interim-panel">
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
          <CardDescription>{t.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground" data-testid="interim-not-graham">
            {t.notGraham}
          </p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{t.latestAnnual}</dt>
              <dd>{interim.latestAnnual ? `FY${interim.latestAnnual.fiscalYear} · ${formatDate(locale, interim.latestAnnual.periodEnd)}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.latestQuarter}</dt>
              <dd>{q ? `FY${q.fiscalYear} ${q.fiscalPeriod} · ${formatDate(locale, q.periodEnd)}${q.form ? ` · ${q.form} ${formatDate(locale, q.filedAt)}` : ""}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.quartersSince}</dt>
              <dd>
                <Num>{String(interim.quartersSinceAnnual)}</Num>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.ttmThrough}</dt>
              <dd>{formatDate(locale, interim.ttmPeriodEnd)}</dd>
            </div>
          </dl>
          {interim.status !== "OK" && <p data-testid="interim-status">{t.status[interim.status]}</p>}
        </CardContent>
      </Card>

      {interim.status === "OK" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t.flagsTitle}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {interim.flags.length === 0 ? (
                <p className="text-muted-foreground">{t.noFlags}</p>
              ) : (
                <ul className="flex list-disc flex-col gap-1 ps-5" data-testid="interim-flags">
                  {interim.flags.map((f) => (
                    <li key={f.code}>{flagText(dict, locale, f)}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.table.metric}</TableHead>
                    <TableHead>{t.table.basis}</TableHead>
                    <TableHead className="text-end">{fmt(t.table.annual, { year: interim.latestAnnual?.fiscalYear ?? "" })}</TableHead>
                    <TableHead className="text-end">{t.table.latest}</TableHead>
                    <TableHead className="text-end">{t.table.change}</TableHead>
                    <TableHead>{t.table.method}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {interim.comparisons.map((c) => (
                    <TableRow key={c.metric}>
                      <TableCell>{t.metrics[c.metric]}</TableCell>
                      <TableCell className="text-xs">{t.kind[c.kind]}</TableCell>
                      <TableCell className="text-end">
                        <Num>{formatMetric(locale, c.metric, c.annual)}</Num>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num>{formatMetric(locale, c.metric, c.latest)}</Num>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num tone={c.metric === "totalDebt" ? signTone(c.change === null ? null : -c.change) : signTone(c.change)}>{formatPercent(locale, c.change, 1)}</Num>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.kind === "TTM" ? (c.method ? t.method[c.method] : t.method.none) : ""}
                        {c.approximate ? ` · ${t.approximate}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">{t.footnote}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
