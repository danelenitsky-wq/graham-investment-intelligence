import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalysisTabs } from "@/components/analysis/analysis-tabs";
import { DataPanel } from "@/components/analysis/data-panel";
import { FinancialHistory } from "@/components/analysis/financial-history";
import { SecurityHeader } from "@/components/analysis/security-header";
import { SummaryPanel } from "@/components/analysis/summary-panel";
import { ValuationPanel } from "@/components/analysis/valuation-panel";
import { RefreshButton, WatchlistButton } from "@/components/finance/action-buttons";
import { DevFixtureBanner, MethodologyBadge } from "@/components/finance/badges";
import { RuleList, RuleRow, ScreenSummary } from "@/components/finance/rule-list";
import { PageSkeleton } from "@/components/finance/states";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import { findSecurity, getSecurityAnalysis } from "@/server/analysis";
import { isOnWatchlist } from "@/server/watchlist";

type Props = PageProps<"/[locale]/stocks/[exchange]/[ticker]">;

export default function StockAnalysisPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Analysis {...props} />
    </Suspense>
  );
}

async function Analysis({ params, searchParams }: Props) {
  const { exchange, ticker } = await params;
  const { locale, dict } = await resolveLocale(params);
  const sp = await searchParams;
  const g = typeof sp.g === "string" && sp.g.trim() !== "" && Number.isFinite(Number(sp.g)) ? Number(sp.g) : null;

  const security = await findSecurity(decodeURIComponent(exchange), decodeURIComponent(ticker));
  if (!security) notFound();
  const [a, onWatchlist] = await Promise.all([getSecurityAnalysis(security.id, { growthPercentOverride: g }), isOnWatchlist(security.id)]);
  if (!a) notFound();
  const currency = a.annual[a.annual.length - 1]?.currency ?? "USD";

  return (
    <div className="flex flex-col gap-4">
      {a.freshness.usesDevFixtureData && <DevFixtureBanner dict={dict} />}
      <SecurityHeader
        a={a}
        dict={dict}
        locale={locale}
        actions={
          <>
            <WatchlistButton securityId={a.security.id} initial={onWatchlist} />
            <RefreshButton securityId={a.security.id} />
          </>
        }
      />
      <AnalysisTabs
        items={[
          { value: "summary", label: dict.stock.tabs.summary, content: <SummaryPanel a={a} dict={dict} locale={locale} /> },
          {
            value: "graham",
            label: dict.stock.tabs.graham,
            content: (
              <div className="flex flex-col gap-5">
                <div className="grid gap-5 xl:grid-cols-2">
                  {[
                    [a.defensive, dict.stock.defensiveScreen],
                    [a.enterprising, dict.stock.enterprisingScreen],
                  ].map(([screen, title]) => {
                    const s = screen as typeof a.defensive;
                    return (
                      <Card key={s.screen}>
                        <CardHeader>
                          <CardTitle>{title as string}</CardTitle>
                          <CardDescription>
                            <ScreenSummary screen={s} dict={dict} />
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <RuleList screen={s} dict={dict} locale={locale} currency={currency} />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
                <Card className="border-info/30">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {dict.valuation.modern} <MethodologyBadge methodology="MODERN_EXTENSION" dict={dict} />
                    </CardTitle>
                    <CardDescription>{dict.valuation.modernNote}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul>
                      <RuleRow rule={a.modern.inflationAdjustedSize} dict={dict} locale={locale} currency={currency} />
                    </ul>
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            value: "valuation",
            label: dict.stock.tabs.valuation,
            content: (
              <ValuationPanel a={a} dict={dict} locale={locale} action={securityPath(locale, a.security.exchangeCode, a.security.ticker)} hidden={{ tab: "valuation" }} />
            ),
          },
          { value: "financials", label: dict.stock.tabs.financials, content: <FinancialHistory a={a} dict={dict} locale={locale} /> },
          { value: "data", label: dict.stock.tabs.data, content: <DataPanel a={a} dict={dict} locale={locale} /> },
        ]}
      />
    </div>
  );
}
