import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { DevFixtureBadge, QuoteStatusBadge } from "@/components/finance/badges";
import { WatchlistButton } from "@/components/finance/action-buttons";
import { Num, signTone } from "@/components/finance/num";
import { CategoryBadge } from "@/components/analysis/decision-panel";
import { AddWatchlistForm, WatchlistTargetForm } from "@/components/holdings/small-actions";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { getWatchlistDashboard } from "@/server/watchlist";
import { EXCHANGES } from "@/server/ingestion";

export default async function WatchlistPage({ params }: PageProps<"/[locale]/watchlist">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.holdings.watchlist.title} subtitle={dict.holdings.watchlist.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content locale={locale} dict={dict} />
      </Suspense>
    </>
  );
}

async function Content({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  // Live data (quotes, freshness, run times) is read per request.
  await connection();
  const t = dict.holdings.watchlist;
  const p = dict.holdings.portfolio;
  const { rows, defaultMarginOfSafetyTarget } = await getWatchlistDashboard();
  const outcomeVariant = (o: string) => (o === "MEETS_ALL" ? "positive" : o === "FAILS_ONE_OR_MORE" ? "negative" : o === "INCOMPLETE_DATA" ? "warning" : "muted");
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t.add}</CardTitle>
        </CardHeader>
        <CardContent>
          <AddWatchlistForm exchanges={EXCHANGES.map((e) => e.code)} />
        </CardContent>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <Card>
          <CardContent>
            <Table data-testid="watchlist-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.security}</TableHead>
                  <TableHead className="text-end">{t.columns.price}</TableHead>
                  <TableHead>{t.columns.qualification}</TableHead>
                  <TableHead>{t.columns.target}</TableHead>
                  <TableHead>{t.columns.mos}</TableHead>
                  <TableHead>{dict.holdings.portfolio.columns.decision}</TableHead>
                  <TableHead>{t.columns.lastAnalysis}</TableHead>
                  <TableHead>{t.columns.freshness}</TableHead>
                  <TableHead>{t.columns.edit}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const mosTarget = r.marginOfSafetyTarget ?? defaultMarginOfSafetyTarget;
                  return (
                    <TableRow key={r.itemId} data-ticker={r.ticker} className="align-top">
                      <TableCell className="align-top">
                        <Link href={securityPath(locale, r.exchangeCode, r.ticker)} className="flex flex-col hover:underline">
                          <span className="flex items-center gap-2">
                            <span className="font-mono font-semibold" dir="ltr">
                              {r.ticker}
                            </span>
                            <span className="text-xs text-muted-foreground">{r.exchangeCode}</span>
                            {r.isDevFixture && <DevFixtureBadge dict={dict} />}
                          </span>
                          <span className="max-w-56 truncate text-xs text-muted-foreground">{locale === "he" && r.nameHe ? r.nameHe : r.name}</span>
                        </Link>
                        {r.notes && <span className="block max-w-56 text-[11px] whitespace-normal text-muted-foreground">{r.notes}</span>}
                      </TableCell>
                      <TableCell className="text-end align-top">
                        <Num>{formatCurrency(locale, r.price.value, r.price.currency)}</Num>
                        <span className="block text-[11px] text-muted-foreground">
                          <Num>{formatDate(locale, r.price.timestamp, { dateStyle: "short", timeStyle: "short" })}</Num>
                          {r.price.manual && ` · ${p.manualPrice}`}
                        </span>
                      </TableCell>
                      <TableCell className="align-top">
                        {r.isEtf ? (
                          <Badge variant="muted">{t.etfNote}</Badge>
                        ) : r.qualification ? (
                          <div className="flex flex-col gap-0.5 text-xs">
                            <Badge variant={outcomeVariant(r.qualification.outcome)}>
                              {p.outcome[r.qualification.outcome]} {r.qualification.outcome !== "NOT_APPLICABLE" && `${r.qualification.passed}/${r.qualification.applicable}`}
                            </Badge>
                            <span className="text-muted-foreground">{dict.decision.strategies[r.strategy]}</span>
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top text-xs">
                        <dl className="grid grid-cols-[auto_auto] gap-x-2">
                          <dt className="text-muted-foreground">{t.yourTarget}</dt>
                          <dd>
                            <Num>{formatCurrency(locale, r.target.price, r.target.currency ?? r.price.currency)}</Num>
                          </dd>
                          {r.target.distance !== null && (
                            <dd className="col-span-2">
                              {r.target.distance <= 0 ? <Badge variant="positive">{t.belowTarget}</Badge> : <Num tone="muted">{fmt(t.toTarget, { pct: formatPercent(locale, -r.target.distance / (1 + r.target.distance)) })}</Num>}
                            </dd>
                          )}
                          <dt className="text-muted-foreground">{fmt(t.ceilingFallback, { strategy: dict.decision.strategies[r.strategy] })}</dt>
                          <dd>
                            <Num>{formatCurrency(locale, r.ceiling, r.ceilingCurrency ?? r.price.currency)}</Num>
                          </dd>
                        </dl>
                      </TableCell>
                      <TableCell className="align-top text-xs">
                        {r.marginOfSafety === null ? (
                          <span className="text-muted-foreground">{t.noIntrinsic}</span>
                        ) : (
                          <Num tone={r.marginOfSafety >= mosTarget ? "positive" : signTone(r.marginOfSafety)}>{formatPercent(locale, r.marginOfSafety)}</Num>
                        )}
                        <span className="block text-[11px] text-muted-foreground">{fmt(t.mosTarget, { pct: formatPercent(locale, mosTarget, 0) })}</span>
                      </TableCell>
                      <TableCell className="align-top">
                        <CategoryBadge category={r.category} dict={dict} />
                      </TableCell>
                      <TableCell className="align-top text-xs">
                        {r.lastAnalysisAt ? <Num>{formatDate(locale, r.lastAnalysisAt, { dateStyle: "short", timeStyle: "short" })}</Num> : <span className="text-muted-foreground">{t.neverAnalysed}</span>}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-1">
                          <QuoteStatusBadge status={r.freshness.quote} dict={dict} />
                          {!r.isEtf && (
                            <Badge variant={r.freshness.fundamentals === "FRESH" ? "positive" : r.freshness.fundamentals === "STALE" || r.freshness.fundamentals === "CONFLICTED" ? "negative" : "muted"} className="font-normal">
                              {dict.stock.tabs.financials}: {dict.market.status[r.freshness.fundamentals]}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <WatchlistTargetForm itemId={r.itemId} targetPrice={r.target.price} mosTarget={r.marginOfSafetyTarget} notes={r.notes} />
                      </TableCell>
                      <TableCell className="align-top">
                        <WatchlistButton securityId={r.securityId} initial />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
