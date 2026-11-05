import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatMetric, formatPercent } from "@/lib/format";
import { lookup, type Dictionary, type Locale } from "@/lib/i18n";
import type { SecurityAnalysis } from "@/server/analysis";
import type { ValueEstimate } from "@/lib/valuation/graham";
import { MethodologyBadge, StatusBadge } from "@/components/finance/badges";
import { MetricRow } from "@/components/finance/metric-card";
import { MEASURE_FORMAT } from "@/components/finance/metric-formats";
import { Num, signTone } from "@/components/finance/num";

function EstimateCard({ e, a, dict, locale, currency }: { e: ValueEstimate; a: SecurityAnalysis; dict: Dictionary; locale: Locale; currency: string }) {
  const meta = (dict.valuation.estimates as Record<string, { title: string; formula: string }>)[e.id] ?? { title: e.id, formula: "" };
  const mos = e.status === "OK" && e.id !== "modern.bondYieldAdjusted" ? a.valuation.marginsOfSafety[e.id] : null;
  const modernMos = e.id === "modern.bondYieldAdjusted" && e.status === "OK" && a.valuation.price !== null && e.value ? (e.value - a.valuation.price) / e.value : null;
  const margin = mos ?? modernMos;
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{meta.title}</div>
          <code className="text-xs text-muted-foreground" dir="ltr">
            {meta.formula}
          </code>
        </div>
        <div className="flex flex-wrap gap-1">
          <MethodologyBadge methodology={e.methodology} dict={dict} />
          <StatusBadge status={e.status} dict={dict} />
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <Num className="text-2xl font-semibold">{formatCurrency(locale, e.value, currency)}</Num>
        {margin !== null && (
          <span className="text-xs text-muted-foreground">
            {dict.metrics.marginOfSafety}: <Num tone={signTone(margin)}>{formatPercent(locale, margin)}</Num>
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{lookup(dict.reasons as Record<string, string>, e.reason)}</div>
      <div>
        {Object.entries(e.inputs)
          .filter(([k]) => MEASURE_FORMAT[k] !== "hidden")
          .map(([k, v]) => (
            <MetricRow key={k} label={lookup(dict.metrics as Record<string, string>, k)} value={v} format={(MEASURE_FORMAT[k] as never) ?? "number"} currency={currency} locale={locale} />
          ))}
      </div>
      {e.assumptions && (
        <ul className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {e.assumptions.map((x) => (
            <li key={x}>• {lookup(dict.assumptions as Record<string, string>, x)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Valuation view (Graham 1973 + clearly separated modern extensions). `action` is the URL the growth form submits to. */
export function ValuationPanel({ a, dict, locale, action, hidden }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale; action: string; hidden?: Record<string, string> }) {
  const currency = a.annual[a.annual.length - 1]?.currency ?? a.price?.currency ?? "USD";
  const m = a.modern.metrics;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{dict.valuation.graham}</CardTitle>
          <CardDescription>
            {dict.metrics.price}: <Num>{formatCurrency(locale, a.valuation.price, currency)}</Num>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={action} method="get" className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/50 p-3">
            {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{dict.valuation.growthOverride}</span>
              <Input name="g" type="number" step="0.1" min="-20" max="50" defaultValue={a.valuation.growthSource === "USER" ? String(a.valuation.growthPercentUsed) : ""} placeholder={a.valuation.historicalGrowth !== null ? (a.valuation.historicalGrowth * 100).toFixed(1) : ""} className="w-32" dir="ltr" />
            </label>
            <Button type="submit" size="sm">
              {dict.valuation.apply}
            </Button>
            <span className="text-xs text-muted-foreground">
              {dict.valuation.growthSource[a.valuation.growthSource]}: <Num>{formatMetric(locale, a.valuation.growthPercentUsed === null ? null : a.valuation.growthPercentUsed / 100, "percent")}</Num>
            </span>
          </form>
          <div className="grid gap-3 md:grid-cols-3">
            {a.valuation.estimates.map((e) => (
              <EstimateCard key={e.id} e={e} a={a} dict={dict} locale={locale} currency={currency} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-info/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {dict.valuation.modern} <MethodologyBadge methodology="MODERN_EXTENSION" dict={dict} />
          </CardTitle>
          <CardDescription>{dict.valuation.modernNote}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <EstimateCard e={a.modern.bondYieldAdjusted} a={a} dict={dict} locale={locale} currency={currency} />
          <div className="rounded-xl border bg-card p-4">
            <MetricRow label={dict.metrics.freeCashFlow} value={m.freeCashFlow} format="compactCurrency" currency={currency} locale={locale} toneBySign />
            <MetricRow label={dict.metrics.freeCashFlowPerShare} value={m.freeCashFlowPerShare} format="currency" currency={currency} locale={locale} />
            <MetricRow label={dict.metrics.freeCashFlowYield} value={m.freeCashFlowYield} format="percent" locale={locale} toneBySign />
            <MetricRow label={dict.metrics.earningsYield} value={m.earningsYield} format="percent" locale={locale} />
            <MetricRow label={dict.metrics.earningsYieldSpreadOverAaa} value={m.earningsYieldSpreadOverAaa} format="percent" locale={locale} toneBySign />
            <MetricRow label={dict.metrics.returnOnEquity} value={m.returnOnEquity} format="percent" locale={locale} />
            <MetricRow label={dict.metrics.debtToEquity} value={m.debtToEquity} format="ratio" locale={locale} />
            <MetricRow label={dict.metrics.interestCoverage} value={m.interestCoverage} format="multiple" locale={locale} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
