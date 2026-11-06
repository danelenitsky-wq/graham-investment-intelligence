import { ArrowLeftRight, Download, FileText, Scale, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Num } from "@/components/finance/num";
import { formatCurrency, formatDate, formatNumber, formatPercent, MISSING } from "@/lib/format";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import {
  evidenceLabel,
  renderFactorReason,
  renderStatement,
  STRATEGIES,
  type CodedStatement,
  type DecisionCategory,
  type FactorStatus,
  type ResearchReport,
  type SnapshotComparison,
} from "@/lib/decision";
import type { SecurityAnalysis } from "@/server/analysis";
import type { StoredDecisionSnapshot } from "@/server/decision";
import { SaveSnapshotButton } from "./decision-actions";

type Variant = "positive" | "negative" | "warning" | "info" | "muted" | "outline";

export const CATEGORY_VARIANT: Record<DecisionCategory, Variant> = {
  BUY_CANDIDATE: "positive",
  HOLD: "info",
  WAIT: "warning",
  REVIEW_FOR_SALE: "negative",
  AVOID: "negative",
  INSUFFICIENT_VERIFIED_DATA: "muted",
};

const FACTOR_VARIANT: Record<FactorStatus, Variant> = {
  FAVORABLE: "positive",
  NEUTRAL: "info",
  UNFAVORABLE: "warning",
  CRITICAL: "negative",
  UNKNOWN: "muted",
  NOT_APPLICABLE: "outline",
};

export function CategoryBadge({ category, dict, className }: { category: DecisionCategory; dict: Dictionary; className?: string }) {
  return (
    <Badge variant={CATEGORY_VARIANT[category]} className={className}>
      {dict.decision.categories[category]}
    </Badge>
  );
}

/** Renders **bold** spans of a template sentence. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>))}
    </>
  );
}

function StatementList({ items, dict, locale, currency, tone }: { items: CodedStatement[]; dict: Dictionary; locale: Locale; currency: string | null; tone?: "negative" | "muted" }) {
  if (!items.length) return null;
  return (
    <ul className={`flex flex-col gap-1.5 text-sm ${tone === "negative" ? "text-negative" : tone === "muted" ? "text-muted-foreground" : ""}`}>
      {items.map((s, i) => (
        <li key={`${s.code}-${i}`} className="flex flex-col gap-0.5">
          <span>• {renderStatement(s, dict, locale, currency)}</span>
          {s.evidence.length > 0 && (
            <span className="ps-3 font-mono text-[10px] text-muted-foreground" dir="ltr">
              {s.evidence.slice(0, 8).map(evidenceLabel).join(" · ")}
              {s.evidence.length > 8 ? " …" : ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Left-to-right isolate for a number inside a Hebrew sentence. */
const iso = (x: string) => `\u2066${x}\u2069`;

function money(locale: Locale, v: number | null, currency: string | null) {
  return v === null ? MISSING : currency ? formatCurrency(locale, v, currency) : formatNumber(locale, v);
}

export function DecisionPanel({
  a,
  dict,
  locale,
  report,
  snapshots,
  comparison,
  compareIds,
  action,
  strategyParam,
}: {
  a: SecurityAnalysis;
  dict: Dictionary;
  locale: Locale;
  report: ResearchReport;
  snapshots: StoredDecisionSnapshot[];
  comparison: SnapshotComparison | null;
  compareIds: { from: string | null; to: string | null };
  action: string;
  strategyParam: string | null;
}) {
  const d = dict.decision;
  const dec = a.decision;
  const k = dec.keyFigures;
  const currency = k.currency;
  const reportHref = `/api/securities/${a.security.id}/report?locale=${locale}${strategyParam ? `&strategy=${strategyParam}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Classification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Scale className="size-4" /> {d.title}
          </CardTitle>
          <CardDescription>{d.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={dec.category} dict={dict} className="px-3 py-1 text-base" />
            {dec.confidence && <Badge variant={dec.confidence === "STANDARD" ? "outline" : "warning"}>{d.confidence[dec.confidence]}</Badge>}
            <Badge variant="outline">
              {dec.strategySource === "POSITION_THESIS" ? d.strategyThesis : d.strategySelected}: {d.strategies[dec.strategy]}
            </Badge>
            <Badge variant={dec.owned ? "info" : "muted"}>{dec.owned ? d.owned : d.notOwned}</Badge>
          </div>
          <p className="text-sm">{d.categoryHelp[dec.category]}</p>
          <form action={action} method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="decision" />
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{d.strategyLabel}</span>
              <NativeSelect name="strategy" defaultValue={dec.selectedStrategy}>
                {STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {d.strategies[s]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button type="submit" size="sm" variant="outline">
              {d.apply}
            </Button>
            {dec.owned && <span className="text-xs text-muted-foreground">{d.strategyHint}</span>}
          </form>
          <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {d.disclaimer}
          </p>
        </CardContent>
      </Card>

      {/* Key figures */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">{d.sections.keyFigures}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            [d.keyFigures.price, money(locale, k.price, currency)],
            [d.keyFigures.ceiling, k.ceiling === null ? d.keyFigures.notEstablished : money(locale, k.ceiling, currency)],
            [d.keyFigures.intrinsicValue, k.intrinsicValue === null ? d.keyFigures.notEstablished : money(locale, k.intrinsicValue, currency)],
            [d.keyFigures.marginOfSafety, k.marginOfSafetyPercent === null ? d.keyFigures.notEstablished : formatPercent(locale, k.marginOfSafetyPercent / 100)],
            [d.keyFigures.grahamNumber, k.grahamNumber === null ? d.keyFigures.notEstablished : money(locale, k.grahamNumber, currency)],
            [d.keyFigures.ncavPerShare, money(locale, k.ncavPerShare, currency)],
            ...(dec.owned ? [[d.keyFigures.excessiveAbove, money(locale, k.excessiveAbove, currency)]] : []),
          ].map(([label, v]) => (
            <div key={label} className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <Num className="text-lg font-semibold">{v}</Num>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{d.sections.reasons}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <StatementList items={dec.reasons} dict={dict} locale={locale} currency={currency} />
            {dec.reviewTriggers.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{d.sections.triggers}</h3>
                <StatementList items={dec.reviewTriggers} dict={dict} locale={locale} currency={currency} tone="negative" />
              </div>
            )}
            {dec.caveats.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{d.sections.caveats}</h3>
                <StatementList items={dec.caveats} dict={dict} locale={locale} currency={currency} tone="muted" />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{d.sections.conditions}</CardTitle>
          </CardHeader>
          <CardContent>
            <StatementList items={dec.conditions} dict={dict} locale={locale} currency={currency} />
          </CardContent>
        </Card>
      </div>

      {/* Factors */}
      <Card>
        <CardHeader>
          <CardTitle>{d.factorsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{d.factorColumns.factor}</TableHead>
                <TableHead>{d.factorColumns.status}</TableHead>
                <TableHead>{d.factorColumns.explanation}</TableHead>
                <TableHead>{d.factorColumns.evidence}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dec.factors.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium whitespace-normal">
                    {d.factors[f.id]}
                    {(f.id === "defensive" || f.id === "enterprising" || f.id === "netNet") && f.inStrategy && <span className="ms-1 text-[10px] text-muted-foreground">({d.inStrategy})</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={FACTOR_VARIANT[f.status]}>{d.factorStatus[f.status]}</Badge>
                  </TableCell>
                  <TableCell className="min-w-64 whitespace-normal text-sm">{renderFactorReason(f, dict, locale, currency)}</TableCell>
                  <TableCell className="max-w-56 whitespace-normal font-mono text-[10px] text-muted-foreground" dir="ltr">
                    {f.evidence.slice(0, 8).map(evidenceLabel).join(" · ") || MISSING}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Report */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <FileText className="size-4" /> {report.title}
            </span>
            <Button asChild size="sm" variant="outline">
              <a href={reportHref}>
                <Download /> {d.report.download}
              </a>
            </Button>
          </CardTitle>
          <CardDescription>{report.narratorNote}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {report.sections.map((s) => (
            <section key={s.id} id={`report-${s.id}`} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{s.title}</h3>
              {s.paragraphs.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  <Rich text={p} />
                </p>
              ))}
              {s.tables.map((t, ti) => (
                <div key={ti} className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {t.columns.map((c) => (
                          <TableHead key={c}>{c}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {t.rows.map((row, ri) => (
                        <TableRow key={ri}>
                          {row.map((c, ci) => (
                            <TableCell key={ci} className="whitespace-normal text-xs">
                              {ci === 0 && t.links?.[ri] ? (
                                <a href={t.links[ri]!} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                                  {c}
                                </a>
                              ) : (
                                c
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
              {s.bullets.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {s.bullets.map((b, i) => (
                    <li key={i}>
                      • <Rich text={b} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </CardContent>
      </Card>

      <SnapshotsCard a={a} dict={dict} locale={locale} snapshots={snapshots} comparison={comparison} compareIds={compareIds} action={action} strategyParam={strategyParam} />
    </div>
  );
}

function SnapshotsCard({
  a,
  dict,
  locale,
  snapshots,
  comparison,
  compareIds,
  action,
  strategyParam,
}: {
  a: SecurityAnalysis;
  dict: Dictionary;
  locale: Locale;
  snapshots: StoredDecisionSnapshot[];
  comparison: SnapshotComparison | null;
  compareIds: { from: string | null; to: string | null };
  action: string;
  strategyParam: string | null;
}) {
  const s = dict.decision.snapshots;
  const d = dict.decision;
  const dt = (iso: string) => formatDate(locale, iso, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>{s.title}</span>
          <SaveSnapshotButton securityId={a.security.id} strategy={strategyParam} />
        </CardTitle>
        <CardDescription>{s.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.none}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.columns.savedAt}</TableHead>
                  <TableHead>{s.columns.category}</TableHead>
                  <TableHead>{s.columns.strategy}</TableHead>
                  <TableHead>{s.columns.price}</TableHead>
                  <TableHead>{s.columns.fiscalYear}</TableHead>
                  <TableHead>{s.columns.trigger}</TableHead>
                  <TableHead>{s.columns.versions}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((x) => {
                  const p = x.snapshot.inputs.price;
                  return (
                    <TableRow key={x.id}>
                      <TableCell className="text-xs">{dt(x.snapshot.createdAt)}</TableCell>
                      <TableCell>
                        <CategoryBadge category={x.snapshot.assessment.category} dict={dict} />
                      </TableCell>
                      <TableCell className="text-xs">{d.strategies[x.snapshot.assessment.strategy]}</TableCell>
                      <TableCell>
                        <Num className="text-xs">{p ? `${formatCurrency(locale, p.value, p.currency)} (${p.date})` : MISSING}</Num>
                      </TableCell>
                      <TableCell className="text-xs">{x.snapshot.inputs.latestFiscalYear ? `FY${x.snapshot.inputs.latestFiscalYear}` : MISSING}</TableCell>
                      <TableCell className="text-xs">{s.triggers[x.snapshot.trigger]}</TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                        d{x.snapshot.versions.decision} · g{x.snapshot.versions.graham}
                      </TableCell>
                      <TableCell>
                        {x.reports[locale] && (
                          <a className="text-xs underline underline-offset-2" href={`/api/securities/${a.security.id}/report?locale=${locale}&snapshot=${x.id}`}>
                            {d.report.download}
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ArrowLeftRight className="size-4" /> {s.compareTitle}
          </h3>
          <p className="text-xs text-muted-foreground">{s.compareHint}</p>
          {snapshots.length < 2 ? (
            <p className="text-sm text-muted-foreground">{s.needTwo}</p>
          ) : (
            <form action={action} method="get" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="tab" value="decision" />
              {strategyParam && <input type="hidden" name="strategy" value={strategyParam} />}
              {(["from", "to"] as const).map((side) => (
                <label key={side} className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">{s[side]}</span>
                  <NativeSelect name={side} defaultValue={compareIds[side] ?? (side === "from" ? snapshots[1].id : snapshots[0].id)}>
                    {snapshots.map((x) => (
                      <option key={x.id} value={x.id}>
                        {dt(x.snapshot.createdAt)} · {d.categories[x.snapshot.assessment.category]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ))}
              <Button type="submit" size="sm" variant="outline">
                {s.compare}
              </Button>
            </form>
          )}
          {comparison && <ComparisonView c={comparison} dict={dict} locale={locale} currency={a.valuationDashboard.currency} />}
        </div>
      </CardContent>
    </Card>
  );
}

export function ComparisonView({ c, dict, locale, currency }: { c: SnapshotComparison; dict: Dictionary; locale: Locale; currency: string | null }) {
  const s = dict.decision.snapshots;
  const d = dict.decision;
  const m = (v: number | null, key: string) =>
    v === null ? MISSING : key === "marginOfSafetyPercent" ? `${formatNumber(locale, v, 1)}%` : key === "currentRatio" ? formatNumber(locale, v, 2) : money(locale, v, currency);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-medium">
        {c.categoryChanged
          ? fmt(s.changedCategory, { from: d.categories[c.from.category], to: d.categories[c.to.category] })
          : fmt(s.unchangedCategory, { category: d.categories[c.to.category] })}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-muted-foreground">{s.driversLabel}:</span>
        {c.drivers.length === 0 ? <span className="text-xs">{s.noDrivers}</span> : c.drivers.map((x) => <Badge key={x} variant="info">{s.drivers[x]}</Badge>)}
      </div>
      {c.price && (
        <p>
          {fmt(s.priceChange, { from: iso(money(locale, c.price.from, currency)), to: iso(money(locale, c.price.to, currency)), change: c.price.change === null ? MISSING : iso(formatPercent(locale, c.price.change)) })}
        </p>
      )}
      {c.filings && <p>{c.filings.revised ? fmt(s.filingSameYear, { fy: c.filings.toYear ?? MISSING }) : fmt(s.filingChange, { from: c.filings.fromYear ?? MISSING, to: c.filings.toYear ?? MISSING })}</p>}
      {[
        [s.factorChanges, c.factorChanges.map((f) => [d.factors[f.id], d.factorStatus[f.from], d.factorStatus[f.to]])],
        [s.ruleChanges, c.ruleChanges.map((r) => [r.id, r.from ? d.report.ruleStatus[r.from] : MISSING, r.to ? d.report.ruleStatus[r.to] : MISSING])],
        [s.metricChanges, c.metricChanges.map((x) => [s.metrics[x.key], m(x.from, x.key), m(x.to, x.key)])],
      ].map(([title, rows]) => {
        const numeric = title === s.metricChanges;
        return (
        <div key={title as string} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold">{title as string}</h4>
          {(rows as string[][]).length === 0 ? (
            <span className="text-xs text-muted-foreground">{s.noChange}</span>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.columnsDiff.item}</TableHead>
                  <TableHead>{s.columnsDiff.before}</TableHead>
                  <TableHead>{s.columnsDiff.after}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows as string[][]).map((r) => (
                  <TableRow key={r[0]}>
                    <TableCell className="text-xs">{r[0]}</TableCell>
                    <TableCell className="text-xs">{numeric ? <Num>{r[1]}</Num> : r[1]}</TableCell>
                    <TableCell className="text-xs">{numeric ? <Num>{r[2]}</Num> : r[2]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        );
      })}
      <StatementChanges c={c} dict={dict} locale={locale} />
    </div>
  );
}

function StatementChanges({ c, dict, locale }: { c: SnapshotComparison; dict: Dictionary; locale: Locale }) {
  const h = dict.holdings.history;
  const s = dict.decision.snapshots;
  const label = (k: string) => (dict.concepts as Record<string, string>)[k] ?? k;
  const changes = c.statementChanges ?? [];
  return (
    <div className="flex flex-col gap-1" data-testid="statement-changes">
      <h4 className="text-xs font-semibold">{h.statementChanges}</h4>
      {changes.length === 0 ? (
        <span className="text-xs text-muted-foreground">{s.noChange}</span>
      ) : (
        changes.map((y) => (
          <div key={y.fiscalYear} className="flex flex-col gap-1">
            <span className="text-xs font-medium">{fmt(y.kind === "NEW" ? h.statementNew : y.kind === "REMOVED" ? h.statementRemoved : h.statementRevised, { fy: y.fiscalYear })}</span>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{h.columns.item}</TableHead>
                  <TableHead>{h.columns.before}</TableHead>
                  <TableHead>{h.columns.after}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {y.concepts.map((x) => (
                  <TableRow key={x.concept}>
                    <TableCell className="text-xs">{label(x.concept)}</TableCell>
                    <TableCell className="text-xs"><Num>{x.from === null ? MISSING : formatNumber(locale, x.from, 2)}</Num></TableCell>
                    <TableCell className="text-xs"><Num>{x.to === null ? MISSING : formatNumber(locale, x.to, 2)}</Num></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))
      )}
    </div>
  );
}
