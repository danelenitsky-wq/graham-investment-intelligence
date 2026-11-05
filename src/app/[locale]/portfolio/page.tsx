import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { MetricCard } from "@/components/finance/metric-card";
import { DevFixtureBadge } from "@/components/finance/badges";
import { Num, signTone } from "@/components/finance/num";
import { PositionForm, RemovePositionButton } from "@/components/finance/position-form";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getPortfolioSummary } from "@/server/portfolio";
import { listExchanges } from "@/server/securities";

export default async function PortfolioPage({ params }: PageProps<"/[locale]/portfolio">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.portfolio.title} subtitle={dict.portfolio.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content locale={locale} dict={dict} />
      </Suspense>
    </>
  );
}

async function Content({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [{ summary, meta }, exchanges] = await Promise.all([getPortfolioSummary(), listExchanges()]);
  const c = summary.currency;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard locale={locale} label={dict.portfolio.marketValue} value={summary.totalMarketValue} format="currency" currency={c} />
        <MetricCard locale={locale} label={dict.portfolio.costBasis} value={summary.totalCost} format="currency" currency={c} />
        <MetricCard locale={locale} label={dict.portfolio.pnl} value={summary.unrealizedPnl} format="currency" currency={c} toneBySign />
        <MetricCard locale={locale} label={`${dict.portfolio.pnl} %`} value={summary.unrealizedPnlPct} format="percent" toneBySign />
      </div>
      {summary.unpricedPositions > 0 && (
        <Alert variant="warning">
          <AlertDescription>{fmt(dict.portfolio.unpriced, { n: summary.unpricedPositions })}</AlertDescription>
        </Alert>
      )}
      {summary.foreignCurrencyPositions > 0 && (
        <Alert variant="info">
          <AlertDescription>{fmt(dict.portfolio.foreign, { n: summary.foreignCurrencyPositions })}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{dict.nav.portfolio}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {summary.positions.length === 0 ? (
            <EmptyState compact title={dict.portfolio.empty} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dict.portfolio.ticker}</TableHead>
                  <TableHead className="text-end">{dict.portfolio.quantity}</TableHead>
                  <TableHead className="text-end">{dict.portfolio.averageCost}</TableHead>
                  <TableHead className="text-end">{dict.portfolio.lastPrice}</TableHead>
                  <TableHead className="text-end">{dict.portfolio.marketValue}</TableHead>
                  <TableHead className="text-end">{dict.portfolio.pnl}</TableHead>
                  <TableHead className="text-end">{dict.portfolio.weight}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.positions.map((p) => {
                  const m = meta.get(p.id)!;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={securityPath(locale, m.exchangeCode, p.ticker)} className="flex items-center gap-2 hover:underline">
                          <span className="font-mono font-semibold" dir="ltr">
                            {p.ticker}
                          </span>
                          <span className="text-xs text-muted-foreground">{m.exchangeCode}</span>
                          {m.isDevFixture && <DevFixtureBadge dict={dict} />}
                        </Link>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num>{formatNumber(locale, p.quantity, 2)}</Num>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num>{formatCurrency(locale, p.averageCost, p.currency)}</Num>
                      </TableCell>
                      <TableCell className="text-end" title={p.lastPriceDate ? formatDate(locale, p.lastPriceDate) : undefined}>
                        <Num>{formatCurrency(locale, p.lastPrice, p.currency)}</Num>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num>{formatCurrency(locale, p.marketValue, p.currency)}</Num>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num tone={signTone(p.unrealizedPnl)}>{formatCurrency(locale, p.unrealizedPnl, p.currency)}</Num>{" "}
                        <Num tone={signTone(p.unrealizedPnlPct)} className="text-xs">
                          {formatPercent(locale, p.unrealizedPnlPct)}
                        </Num>
                      </TableCell>
                      <TableCell className="text-end">
                        <Num>{formatPercent(locale, p.weight)}</Num>
                      </TableCell>
                      <TableCell className="text-end">
                        <RemovePositionButton id={p.id} label={dict.common.remove} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{dict.portfolio.totals}</TableCell>
                  <TableCell colSpan={3} />
                  <TableCell className="text-end">
                    <Num>{formatCurrency(locale, summary.totalMarketValue, c)}</Num>
                  </TableCell>
                  <TableCell className="text-end">
                    <Num tone={signTone(summary.unrealizedPnl)}>{formatCurrency(locale, summary.unrealizedPnl, c)}</Num>
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
          <div className="border-t pt-4">
            <PositionForm exchanges={exchanges.filter((e) => e._count.securities > 0).map((e) => e.code)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
