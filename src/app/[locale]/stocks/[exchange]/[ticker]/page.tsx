import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AnalysisTabs } from "@/components/analysis/analysis-tabs";
import { DataPanel } from "@/components/analysis/data-panel";
import { DecisionPanel } from "@/components/analysis/decision-panel";
import { FinancialHistory } from "@/components/analysis/financial-history";
import { GrahamPanels } from "@/components/analysis/graham-panels";
import { SecurityHeader } from "@/components/analysis/security-header";
import { SummaryPanel } from "@/components/analysis/summary-panel";
import { ValuationPanel } from "@/components/analysis/valuation-panel";
import { RefreshButton, WatchlistButton } from "@/components/finance/action-buttons";
import { DevFixtureBanner, InsufficientDataBanner } from "@/components/finance/badges";
import { PageSkeleton } from "@/components/finance/states";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import { findSecurity, getSecurityAnalysis } from "@/server/analysis";
import { isOnWatchlist } from "@/server/watchlist";
import { getQuoteView } from "@/server/quotes";
import { compareStored, listDecisionSnapshots, researchReport } from "@/server/decision";
import { STRATEGIES, type Strategy } from "@/lib/decision";

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
  const strategy = typeof sp.strategy === "string" && STRATEGIES.includes(sp.strategy as Strategy) ? (sp.strategy as Strategy) : null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);

  const security = await findSecurity(decodeURIComponent(exchange), decodeURIComponent(ticker));
  if (!security) notFound();
  // Opening the page fetches the latest available quote (subject to the cache policy).
  const quote = await getQuoteView(security.id);
  const [a, onWatchlist, snapshots] = await Promise.all([
    getSecurityAnalysis(security.id, { growthPercentOverride: g, quote, strategy }),
    isOnWatchlist(security.id),
    listDecisionSnapshots(security.id),
  ]);
  if (!a) notFound();
  const report = researchReport(a, locale);
  const fromSnap = snapshots.find((x) => x.id === str(sp.from));
  const toSnap = snapshots.find((x) => x.id === str(sp.to));
  const comparison = fromSnap && toSnap && fromSnap.id !== toSnap.id ? compareStored(fromSnap, toSnap) : snapshots.length >= 2 && !sp.from && !sp.to ? compareStored(snapshots[1], snapshots[0]) : null;
  const gated = !a.health.gate.sufficient;
  const gate = gated ? <InsufficientDataBanner dict={dict} /> : null;

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
          {
            value: "summary",
            label: dict.stock.tabs.summary,
            content: (
              <div className="flex flex-col gap-5">
                {gate}
                <SummaryPanel a={a} dict={dict} locale={locale} gated={gated} />
              </div>
            ),
          },
          {
            value: "decision",
            label: dict.stock.tabs.decision,
            content: (
              <DecisionPanel
                a={a}
                dict={dict}
                locale={locale}
                report={report}
                snapshots={snapshots}
                comparison={comparison}
                compareIds={{ from: fromSnap?.id ?? null, to: toSnap?.id ?? null }}
                action={securityPath(locale, a.security.exchangeCode, a.security.ticker)}
                strategyParam={strategy}
              />
            ),
          },
          {
            value: "graham",
            label: dict.stock.tabs.graham,
            content: (
              <div className="flex flex-col gap-5">
                {gate}
                <GrahamPanels a={a} dict={dict} locale={locale} gated={gated} />
              </div>
            ),
          },
          {
            value: "valuation",
            label: dict.stock.tabs.valuation,
            content: (
              <div className="flex flex-col gap-5">
                {gate}
                <ValuationPanel a={a} dict={dict} locale={locale} action={securityPath(locale, a.security.exchangeCode, a.security.ticker)} hidden={{ tab: "valuation" }} gated={gated} />
              </div>
            ),
          },
          { value: "financials", label: dict.stock.tabs.financials, content: <FinancialHistory a={a} dict={dict} locale={locale} /> },
          { value: "data", label: dict.stock.tabs.data, content: <DataPanel a={a} dict={dict} locale={locale} /> },
        ]}
      />
    </div>
  );
}
