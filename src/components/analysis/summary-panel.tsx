import { Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/finance/metric-card";
import { ScreenStrip, ScreenSummary } from "@/components/finance/rule-list";
import { EmptyState } from "@/components/finance/states";
import { PriceChart } from "@/components/charts/price-chart";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { SecurityAnalysis } from "@/server/analysis";
import { averageEps, bookValuePerShare, currentRatio, latest, ncavPerShare } from "@/lib/graham/metrics";

export function SummaryPanel({ a, dict, locale, gated = false }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale; gated?: boolean }) {
  const last = latest(a.annual);
  const currency = last?.currency ?? a.price?.currency ?? "USD";
  const price = a.valuation.price;
  const eps3 = averageEps(a.annual, 3);
  const bvps = bookValuePerShare(last);
  const dps = last?.values.dividendsPerShare ?? null;
  const pe3 = a.defensive.rules.find((r) => r.id === "defensive.moderatePe")?.measured.pe3y ?? null;
  const pb = a.defensive.rules.find((r) => r.id === "defensive.moderatePriceToAssets")?.measured.priceToBook ?? null;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{dict.stock.priceChart}</CardTitle>
        </CardHeader>
        <CardContent>
          {a.priceHistory.length > 1 ? (
            <PriceChart
              data={a.priceHistory}
              currency={a.price?.currency ?? currency}
              overlays={a.valuation.estimates
                .filter((e) => e.status === "OK" && e.value !== null && e.id !== "graham.ncav")
                .map((e) => ({ label: (dict.valuation.estimates as Record<string, { title: string }>)[e.id]?.title ?? e.id, value: e.value! }))}
            />
          ) : (
            <EmptyState title={dict.stock.noPrice} body={dict.stock.noPriceHint} />
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">{dict.stock.keyMetrics}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard locale={locale} label={dict.metrics.price} value={a.price?.value} format="currency" currency={a.price?.currency ?? currency} hint={!a.price ? dict.stock.noPriceHint : undefined} />
          <MetricCard locale={locale} label={dict.metrics.eps3y} value={eps3} format="currency" currency={currency} hint={dict.assumptions.normalEarnings3y} />
          <MetricCard locale={locale} label={dict.metrics.pe3y} value={pe3} format="multiple" />
          <MetricCard locale={locale} label={dict.metrics.bookValuePerShare} value={bvps} format="currency" currency={currency} hint={dict.assumptions.bookValueCommonEquity} />
          <MetricCard locale={locale} label={dict.metrics.priceToBook} value={pb} format="multiple" />
          <MetricCard locale={locale} label={dict.metrics.currentRatio} value={currentRatio(last)} format="ratio" />
          <MetricCard locale={locale} label={dict.metrics.dividendYield} value={dps !== null && price ? dps / price : null} format="percent" />
          <MetricCard locale={locale} label={dict.metrics.ncavPerShare} value={ncavPerShare(last)} format="currency" currency={currency} toneBySign />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {[
          [a.defensive, dict.stock.defensiveScreen],
          [a.enterprising, dict.stock.enterprisingScreen],
        ].map(([s, title]) => {
          const screen = s as SecurityAnalysis["defensive"];
          return (
            <Card key={screen.screen}>
              <CardHeader>
                <CardTitle>{title as string}</CardTitle>
                <CardDescription>
                  {gated ? <span className="font-semibold text-negative">{dict.health.insufficient}</span> : <ScreenSummary screen={screen} dict={dict} />}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScreenStrip screen={screen} dict={dict} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Lock className="size-4" /> {dict.stock.decisionPending}
          </CardTitle>
          <CardDescription>{dict.stock.decisionPendingBody}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
