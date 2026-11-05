import { AlertTriangle, ExternalLink, Info, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnnualBarChart, PerShareLineChart } from "@/components/charts/history-charts";
import { PriceChart } from "@/components/charts/price-chart";
import { Num } from "@/components/finance/num";
import { formatValue, RuleList, ruleName, ScreenSummary } from "@/components/finance/rule-list";
import { formatDate } from "@/lib/format";
import { fmt, lookup, type Dictionary, type Locale } from "@/lib/i18n";
import type { RiskIndicator } from "@/lib/graham/netnet";
import type { RuleResult, ScreenResult, SourceRef } from "@/lib/graham/types";
import type { SecurityAnalysis } from "@/server/analysis";
import { cn } from "@/lib/utils";

type G = Dictionary["graham"];

function GroupChips({ label, rules, g, tone }: { label: string; rules: RuleResult[]; g: G; tone: "positive" | "negative" | "warning" | "muted" }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-2" data-group={tone}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <Num className="text-muted-foreground">{String(rules.length)}</Num>
      </div>
      <div className="flex flex-wrap gap-1">
        {rules.length ? (
          rules.map((r) => (
            <Badge key={r.id} variant={tone} className="font-normal" title={ruleName(g, r.id).name}>
              <bdi dir="ltr">{r.id === "NN1" ? "NN" : r.id}</bdi>
            </Badge>
          ))
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function QualificationBlock({ screen, dict }: { screen: ScreenResult; dict: Dictionary }) {
  const g = dict.graham;
  const counted = screen.rules.filter((r) => r.counted);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{g.overall}:</span>
        <ScreenSummary screen={screen} dict={dict} />
        <Badge variant="outline" className="font-normal">
          {g.ruleSet[screen.ruleSet]}
        </Badge>
      </div>
      {screen.unverifiedCounted > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {fmt(g.unverifiedCounted, { n: screen.unverifiedCounted })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <GroupChips label={g.passedTests} rules={counted.filter((r) => r.status === "PASS")} g={g} tone="positive" />
        <GroupChips label={g.failedTests} rules={counted.filter((r) => r.status === "FAIL")} g={g} tone="negative" />
        <GroupChips label={g.missingData} rules={counted.filter((r) => r.status === "INSUFFICIENT_DATA")} g={g} tone="warning" />
        <GroupChips label={g.notApplicableTests} rules={counted.filter((r) => r.status === "NOT_APPLICABLE")} g={g} tone="muted" />
      </div>
    </div>
  );
}

/** Unique filing / provider links used by a panel's rules, newest period first. */
function SourceLinks({ rules, dict }: { rules: RuleResult[]; dict: Dictionary }) {
  const seen = new Map<string, SourceRef>();
  for (const r of rules) for (const s of r.sources) seen.set(`${s.kind}|${s.label}|${s.period}|${s.url}`, s);
  const list = [...seen.values()].sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));
  if (!list.length) return null;
  return (
    <details className="rounded-md border px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium">
        {dict.graham.sources} (<Num>{String(list.length)}</Num>)
      </summary>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {list.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                {s.label} <ExternalLink className="size-3" />
              </a>
            ) : (
              <span>{s.label}</span>
            )}
            {s.period && (
              <bdi dir="ltr" className="text-muted-foreground">
                {s.period}
              </bdi>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function RiskList({ risks, dict, locale, currency }: { risks: RiskIndicator[]; dict: Dictionary; locale: string; currency: string }) {
  const g = dict.graham;
  if (!risks.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{g.risks.title}</h3>
      <p className="text-xs text-muted-foreground">{g.risks.note}</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {risks.map((r) => (
          <li key={r.id} className="rounded-lg border p-3" data-risk-id={r.id} data-risk-level={r.level}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium">{g.risks.names[r.id]}</span>
              <Badge variant={r.level === "LOW" ? "positive" : r.level === "WATCH" ? "warning" : r.level === "HIGH" ? "negative" : "muted"}>{g.risks.levels[r.level]}</Badge>
            </div>
            <p className="mt-1 text-xs">{fmt(lookup(g.risks.reasons as Record<string, string>, r.reason), r.reasonParams ?? {})}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {r.values.map((v, i) => (
                <div key={`${v.key}-${i}`} className="flex min-w-0 justify-between gap-2">
                  <dt className="truncate text-muted-foreground">
                    {lookup(g.values as Record<string, string>, v.key)}
                    {v.fiscalYear ? <bdi dir="ltr"> FY{v.fiscalYear}</bdi> : null}
                  </dt>
                  <dd>
                    <Num>{formatValue(locale, v.value, v.unit, currency)}</Num>
                  </dd>
                </div>
              ))}
            </dl>
            {r.period && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {g.period}: <bdi dir="ltr">{r.period}</bdi>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GrahamPanels({ a, dict, locale, gated = false }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale; gated?: boolean }) {
  const g = dict.graham;
  const { graham } = a;
  const currency = a.annual[a.annual.length - 1]?.currency ?? "USD";
  const trends = graham.trends;
  const rows = trends as unknown as Record<string, number | null>[];
  const cls = graham.classification;
  const basis = fmt(lookup(g.classificationBasis as Record<string, string>, cls.basis), { sic: cls.sicCode ?? "—" });
  const nn = graham.netNet;

  const panel = (screen: ScreenResult, extra?: React.ReactNode, charts?: React.ReactNode) => (
    <Card key={screen.screen} data-panel={screen.screen}>
      <CardHeader>
        <CardTitle>{g.panels[screen.screen].title}</CardTitle>
        <CardDescription>{g.panels[screen.screen].subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {gated && <p className="text-xs font-semibold text-negative">{dict.health.insufficient}</p>}
        <QualificationBlock screen={screen} dict={dict} />
        {extra}
        <RuleList screen={screen} dict={dict} locale={locale} currency={currency} />
        {charts && (
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-medium">{g.trends.title}</h3>
            {trends.length > 1 ? charts : <p className="text-xs text-muted-foreground">{g.trends.noData}</p>}
          </div>
        )}
        <SourceLinks rules={screen.rules} dict={dict} />
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Info className="size-3.5" />
        {fmt(g.issuerType, { type: g.industryClass[cls.industryClass], basis })}
        <span>·</span>
        <span>{dict.common.notRecommendation}</span>
      </div>

      {panel(
        graham.defensive,
        graham.excludedDistributions.length > 0 ? (
          <div role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <div>
              <div className="font-medium">{g.excluded.title}</div>
              <p className="text-muted-foreground">{g.excluded.body}</p>
              <ul className="mt-1">
                {graham.excludedDistributions.map((x) => (
                  <li key={x.exDate}>
                    {fmt(g.excluded.row, {
                      date: formatDate(locale, x.exDate),
                      amount: formatValue(locale, x.amount, "perShare", currency),
                      share: formatValue(locale, x.shareOfPrice, "percent", currency),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null,
        <>
          <ChartBlock title={`${g.trends.revenue} / ${g.trends.netIncome}`}>
            <AnnualBarChart
              data={rows}
              currency={currency}
              series={[
                { key: "revenue", label: g.trends.revenue, color: "var(--color-chart-1)" },
                { key: "netIncome", label: g.trends.netIncome, color: "var(--color-chart-2)" },
              ]}
            />
          </ChartBlock>
          <ChartBlock title={`${g.trends.eps} · ${g.trends.dividendsPerShare}`}>
            <PerShareLineChart
              data={rows}
              currency={currency}
              series={[
                { key: "eps", label: g.trends.eps, color: "var(--color-chart-1)" },
                { key: "eps3yAvg", label: g.trends.eps3yAvg, color: "var(--color-chart-3)" },
                { key: "dividendsPerShare", label: g.trends.dividendsPerShare, color: "var(--color-chart-2)" },
                { key: "providerDividends", label: g.trends.providerDividends, color: "var(--color-chart-4)" },
              ]}
            />
          </ChartBlock>
          <ChartBlock title={g.trends.currentRatio}>
            <PerShareLineChart data={rows} currency={currency} format="ratio" series={[{ key: "currentRatio", label: g.trends.currentRatio, color: "var(--color-chart-1)" }]} />
          </ChartBlock>
        </>,
      )}

      {panel(
        graham.enterprising,
        <p className="text-xs text-muted-foreground">{g.enterprisingScope}</p>,
        <>
          <ChartBlock title={`${g.trends.netWorkingCapital} / ${g.trends.longTermDebt}`}>
            <AnnualBarChart
              data={rows}
              currency={currency}
              series={[
                { key: "netWorkingCapital", label: g.trends.netWorkingCapital, color: "var(--color-chart-1)" },
                { key: "longTermDebt", label: g.trends.longTermDebt, color: "var(--color-chart-5)" },
              ]}
            />
          </ChartBlock>
          <ChartBlock title={`${g.trends.eps} · ${g.trends.tangibleBookValuePerShare}`}>
            <PerShareLineChart
              data={rows}
              currency={currency}
              series={[
                { key: "eps", label: g.trends.eps, color: "var(--color-chart-1)" },
                { key: "bookValuePerShare", label: g.trends.bookValuePerShare, color: "var(--color-chart-3)" },
                { key: "tangibleBookValuePerShare", label: g.trends.tangibleBookValuePerShare, color: "var(--color-chart-2)" },
              ]}
            />
          </ChartBlock>
        </>,
      )}

      {panel(
        nn.screen,
        <>
          <p className="flex items-start gap-1.5 rounded-md border border-info/40 bg-info/10 p-2 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {g.notBuy}
          </p>
          {nn.screen.ruleSet !== "NONE" && (
            <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
              {(
                [
                  ["ncav", nn.ncav, "currency"],
                  ["ncavPerShare", nn.ncavPerShare, "perShare"],
                  ["netNetThreshold", nn.purchaseThreshold, "perShare"],
                  ["price", a.price?.value ?? null, "perShare"],
                ] as const
              ).map(([k, v, unit]) => (
                <div key={k} className={cn("rounded-md border p-2")}>
                  <dt className="text-muted-foreground">{lookup(g.values as Record<string, string>, k)}</dt>
                  <dd className="text-sm">
                    <Num>{formatValue(locale, v, unit, k === "price" ? (a.price?.currency ?? currency) : currency)}</Num>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {nn.screen.ruleSet !== "NONE" && a.priceHistory.length > 1 && (
            <ChartBlock title={g.trends.priceVsNcav}>
              <PriceChart
                data={a.priceHistory}
                currency={a.price?.currency ?? currency}
                overlays={[
                  ...(nn.ncavPerShare !== null && nn.ncavPerShare > 0 ? [{ label: g.trends.ncavPerShare, value: nn.ncavPerShare }] : []),
                  ...(nn.purchaseThreshold !== null && nn.purchaseThreshold > 0 ? [{ label: g.trends.threshold, value: nn.purchaseThreshold }] : []),
                ]}
              />
            </ChartBlock>
          )}
          <RiskList risks={nn.risks} dict={dict} locale={locale} currency={currency} />
        </>,
        nn.screen.ruleSet !== "NONE" ? (
          <>
            <ChartBlock title={`${g.trends.ncavPerShare} · ${g.trends.bookValuePerShare}`}>
              <PerShareLineChart
                data={rows}
                currency={currency}
                series={[
                  { key: "ncavPerShare", label: g.trends.ncavPerShare, color: "var(--color-chart-1)" },
                  { key: "tangibleBookValuePerShare", label: g.trends.tangibleBookValuePerShare, color: "var(--color-chart-3)" },
                ]}
              />
            </ChartBlock>
            <ChartBlock title={`${g.trends.ncav} / ${g.trends.freeCashFlow}`}>
              <AnnualBarChart
                data={rows}
                currency={currency}
                series={[
                  { key: "ncav", label: g.trends.ncav, color: "var(--color-chart-1)" },
                  { key: "freeCashFlow", label: g.trends.freeCashFlow, color: "var(--color-chart-2)" },
                ]}
              />
            </ChartBlock>
          </>
        ) : undefined,
      )}
    </div>
  );
}
