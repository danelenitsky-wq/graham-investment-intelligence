import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { DevFixtureBadge, QuoteStatusBadge } from "@/components/finance/badges";
import { Num, signTone } from "@/components/finance/num";
import { CategoryBadge } from "@/components/analysis/decision-panel";
import { HoldingForm } from "@/components/holdings/holding-form";
import { CsvImport } from "@/components/holdings/csv-import";
import { DeleteFxButton, FetchFxButton, ManualFxForm, ManualPriceForm, type ManualPriceTarget } from "@/components/holdings/price-fx-forms";
import { BaseCurrencySelect, RefreshQuotesButton, RemoveHoldingButton } from "@/components/holdings/small-actions";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import { formatCurrency, formatDate, formatNumber, formatPercent, formatRatio, MISSING } from "@/lib/format";
import type { HoldingsSummary } from "@/lib/portfolio";
import { getPortfolioDashboard, type HoldingRow, type ScreenSummary } from "@/server/portfolio";
import { listFxRates } from "@/server/fx";
import { listManualPrices } from "@/server/manual-prices";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { EXCHANGES } from "@/server/ingestion";

export default async function PortfolioPage({ params }: PageProps<"/[locale]/portfolio">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.holdings.portfolio.title} subtitle={dict.holdings.portfolio.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content locale={locale} dict={dict} />
      </Suspense>
    </>
  );
}

const dt = (locale: Locale, iso: string | null, tz?: string) => formatDate(locale, iso, tz ? { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short" } : { dateStyle: "short", timeStyle: "short" });

async function Content({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  // Live data (quotes, freshness, run times) is read per request.
  await connection();
  const h = dict.holdings;
  const [dash, fxRates, manualPrices, ilSecurities] = await Promise.all([
    getPortfolioDashboard(),
    listFxRates(20),
    listManualPrices(10),
    db.security.findMany({
      where: { exchange: { market: "IL" }, OR: [{ positions: { some: {} } }, { watchlistItems: { some: {} } }] },
      include: { exchange: true },
      orderBy: { ticker: "asc" },
    }),
  ]);
  const exchanges: string[] = EXCHANGES.map((e) => e.code);
  const targets: ManualPriceTarget[] = ilSecurities.map((s) => ({ securityId: s.id, ticker: s.ticker, exchangeCode: s.exchange.code, currency: "ILS", timezone: s.exchange.timezone }));
  const s = dash.summary;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BaseCurrencySelect value={dash.portfolio.baseCurrency} />
        <RefreshQuotesButton />
      </div>

      <Totals summary={s} locale={locale} dict={dict} />

      <Card>
        <CardHeader>
          <CardTitle>{fmt(h.portfolio.positions, { n: dash.rows.length })}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {dash.rows.length === 0 ? (
            <EmptyState compact title={h.portfolio.empty} />
          ) : (
            <>
              <HoldingsTable rows={dash.rows} locale={locale} dict={dict} />
              <p className="text-xs text-muted-foreground">{h.portfolio.peNote}</p>
              {s.consolidated === null && s.byCurrency.length > 1 && <p className="text-xs text-muted-foreground">{h.portfolio.weightUnavailable}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{h.form.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <HoldingForm exchanges={exchanges} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{h.import.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <CsvImport />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{h.tase.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-xs text-muted-foreground">{h.tase.coverage}</p>
            <p className="text-xs">{fmt(h.tase.datahub, { status: env().TASE_DATAHUB_API_KEY ? h.tase.configured : h.tase.notConfigured })}</p>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{h.manualPrice.title}</h3>
              <p className="text-xs text-muted-foreground">{h.manualPrice.subtitle}</p>
              <ManualPriceForm targets={targets} />
            </div>
            {manualPrices.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-xs font-semibold">{h.manualPrice.recent}</h4>
                <Table>
                  <TableBody>
                    {manualPrices.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          {m.security.ticker}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Num>{`${formatNumber(locale, m.enteredPrice === null ? null : Number(m.enteredPrice), 2)} ${m.enteredUnit ?? ""}`}</Num> →{" "}
                          <Num>{formatCurrency(locale, Number(m.price), m.currency)}</Num>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Num>{dt(locale, m.sourceTimestamp.toISOString(), m.security.exchange.timezone)}</Num>
                        </TableCell>
                        <TableCell className="text-xs whitespace-normal">{m.sourceLabel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{h.fx.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{h.fx.subtitle}</p>
            <FetchFxButton />
            {fxRates.length === 0 ? (
              <p className="text-xs text-muted-foreground">{h.fx.none}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{h.fx.columns.pair}</TableHead>
                    <TableHead className="text-end">{h.fx.columns.rate}</TableHead>
                    <TableHead>{h.fx.columns.date}</TableHead>
                    <TableHead>{h.fx.columns.kind}</TableHead>
                    <TableHead>{h.fx.columns.source}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fxRates.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{`${r.base}/${r.quote}`}</TableCell>
                      <TableCell className="text-end">
                        <Num>{formatNumber(locale, r.rate, 4)}</Num>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Num>{r.date}</Num>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.kind === "OFFICIAL" ? "positive" : "warning"}>{h.fx.kinds[r.kind]}</Badge>
                      </TableCell>
                      <TableCell className="text-xs whitespace-normal">{r.sourceLabel}</TableCell>
                      <TableCell>{r.kind === "MANUAL" && <DeleteFxButton id={r.id} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex flex-col gap-1 border-t pt-3">
              <h4 className="text-xs font-semibold">{h.fx.manualTitle}</h4>
              <ManualFxForm />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Totals({ summary, locale, dict }: { summary: HoldingsSummary; locale: Locale; dict: Dictionary }) {
  const h = dict.holdings.portfolio;
  if (!summary.byCurrency.length) return null;
  const c = summary.consolidated;
  const blocked = summary.consolidationBlocked[0];
  return (
    <div className="flex flex-col gap-3" data-testid="portfolio-totals">
      <div className="grid gap-3 md:grid-cols-2">
        {summary.byCurrency.map((t) => (
          <Card key={t.currency} data-currency={t.currency}>
            <CardContent className="flex flex-col gap-1 pt-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{dict.holdings.portfolio.byCurrency}</span>
                <Badge variant="outline" className="font-mono">
                  {t.currency}
                </Badge>
              </div>
              <div className="text-2xl font-semibold">
                <Num>{formatCurrency(locale, t.marketValue, t.currency)}</Num>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>
                  {dict.portfolio.costBasis}: <Num>{formatCurrency(locale, t.pricedCost, t.currency)}</Num>
                </span>
                <span>
                  {h.columns.pnl}: <Num tone={signTone(t.unrealizedPnl)}>{formatCurrency(locale, t.unrealizedPnl, t.currency)}</Num>{" "}
                  <Num tone={signTone(t.unrealizedReturn)}>{formatPercent(locale, t.unrealizedReturn)}</Num>
                </span>
                <span>{fmt(h.positions, { n: t.positions })}</span>
                {t.unpriced > 0 && <span className="text-warning">{fmt(h.unpriced, { n: t.unpriced })}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {c ? (
        <Alert variant="info" data-testid="consolidated-total">
          <AlertDescription className="flex flex-col gap-1">
            <span className="font-medium">
              {fmt(h.consolidated, { currency: c.baseCurrency })}: <Num>{formatCurrency(locale, c.marketValue, c.baseCurrency)}</Num>
              {c.unrealizedPnl !== null && (
                <>
                  {" · "}
                  <Num tone={signTone(c.unrealizedPnl)}>{formatCurrency(locale, c.unrealizedPnl, c.baseCurrency)}</Num>{" "}
                  <Num tone={signTone(c.unrealizedReturn)}>{formatPercent(locale, c.unrealizedReturn)}</Num>
                </>
              )}
            </span>
            {c.unrealizedPnl !== null ? (
              <span className="text-xs" data-testid="consolidated-pnl-split">
                {fmt(h.consolidatedPnl, { currency: c.baseCurrency })}.{" "}
                {fmt(h.pnlSplit, { price: formatCurrency(locale, c.priceEffect, c.baseCurrency), fx: formatCurrency(locale, c.fxEffect, c.baseCurrency) })}.{" "}
                {fmt(h.costAtPurchaseRates, { cost: formatCurrency(locale, c.pricedCost, c.baseCurrency), costNow: formatCurrency(locale, c.pricedCostAtCurrentRates, c.baseCurrency) })}
              </span>
            ) : (
              c.pnlBlocked.length > 0 && (
                <span className="text-xs text-warning" data-testid="consolidated-pnl-blocked">
                  {fmt(h.pnlUnavailable, {
                    tickers: c.pnlBlocked.map((b) => b.ticker).join(", "),
                    reason: (() => {
                      const issue = c.pnlBlocked[0].issue;
                      const from = summary.holdings.find((x) => x.id === c.pnlBlocked[0].holdingId)?.currency ?? "";
                      return fmt(h.pnlIssue[issue.reason], { from, to: c.baseCurrency, date: issue.reason === "HISTORICAL_FX_UNAVAILABLE" ? issue.date : "" });
                    })(),
                  })}
                </span>
              )
            )}
            {c.conversions.map((x) => (
              <span key={x.from} className="text-xs">
                {fmt(h.consolidatedVia, {
                  rate: `1 ${x.rate.base} = ${formatNumber(locale, x.rate.rate, 4)} ${x.rate.quote}`,
                  kind: dict.holdings.fx.kinds[x.rate.kind],
                  source: x.rate.sourceLabel,
                  date: x.rate.date,
                })}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : (
        summary.byCurrency.length > 1 &&
        blocked && (
          <Alert variant="warning" data-testid="no-consolidated-total">
            <AlertDescription className="flex flex-col gap-1">
              <span>{fmt(h.notConsolidated, { reason: fmt(h.blockedReasons[blocked.reason], { from: blocked.from, to: summary.baseCurrency }) })}</span>
              <span className="text-xs">{h.separateTotalsNote}</span>
            </AlertDescription>
          </Alert>
        )
      )}
    </div>
  );
}

function ScreenCell({ s, label, dict }: { s: ScreenSummary; label: string; dict: Dictionary }) {
  const variant = s.outcome === "MEETS_ALL" ? "positive" : s.outcome === "FAILS_ONE_OR_MORE" ? "negative" : s.outcome === "INCOMPLETE_DATA" ? "warning" : "muted";
  return (
    <Badge variant={variant} className="font-normal" title={dict.holdings.portfolio.outcome[s.outcome]}>
      {label} {s.outcome === "NOT_APPLICABLE" ? dict.holdings.portfolio.outcome.NOT_APPLICABLE : `${s.passed}/${s.applicable}`}
    </Badge>
  );
}

function HoldingsTable({ rows, locale, dict }: { rows: HoldingRow[]; locale: Locale; dict: Dictionary }) {
  const h = dict.holdings.portfolio;
  const col = h.columns;
  return (
    <Table data-testid="holdings-table">
      <TableHeader>
        <TableRow>
          <TableHead>{col.security}</TableHead>
          <TableHead className="text-end">{col.quantity}</TableHead>
          <TableHead className="text-end">{col.averageCost}</TableHead>
          <TableHead className="text-end">{col.price}</TableHead>
          <TableHead>{col.quoteTime}</TableHead>
          <TableHead className="text-end">{col.marketValue}</TableHead>
          <TableHead className="text-end">{col.pnl}</TableHead>
          <TableHead className="text-end">{col.return}</TableHead>
          <TableHead className="text-end">{col.weight}</TableHead>
          <TableHead className="text-end">{col.fromHigh}</TableHead>
          <TableHead className="text-end">{col.pe}</TableHead>
          <TableHead className="text-end">{col.pb}</TableHead>
          <TableHead>{col.graham}</TableHead>
          <TableHead>{col.thresholds}</TableHead>
          <TableHead>{col.decision}</TableHead>
          <TableHead>{col.freshness}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} data-ticker={r.ticker} className="align-top">
            <TableCell className="align-top">
              <Link href={securityPath(locale, r.exchangeCode, r.ticker)} className="flex flex-col hover:underline">
                <span className="flex items-center gap-2">
                  <span className="font-mono font-semibold" dir="ltr">
                    {r.ticker}
                  </span>
                  <span className="text-xs text-muted-foreground">{r.exchangeCode}</span>
                  {r.isEtf && <Badge variant="info">{h.etf.badge}</Badge>}
                  {r.isDevFixture && <DevFixtureBadge dict={dict} />}
                </span>
                <span className="max-w-56 truncate text-xs text-muted-foreground">{r.name}</span>
              </Link>
              {r.isUserEntered && <span className="block max-w-56 text-[11px] whitespace-normal text-warning">{h.userEntered}</span>}
            </TableCell>
            <TableCell className="text-end align-top">
              <Num>{formatNumber(locale, r.quantity, r.quantity % 1 ? 4 : 0)}</Num>
            </TableCell>
            <TableCell className="text-end align-top">
              <Num>{formatCurrency(locale, r.averageCost, r.currency)}</Num>
              {r.costInputUnit === "ILA" && <span className="block text-[11px] text-muted-foreground">{fmt(h.costUnit, { unit: "ILA" })}</span>}
            </TableCell>
            <TableCell className="text-end align-top">
              <Num>{r.unpricedReason === "PRICE_CURRENCY_MISMATCH" ? MISSING : formatCurrency(locale, r.lastPrice, r.currency)}</Num>
              {r.quote.manual && <span className="block text-[11px] text-muted-foreground">{h.manualPrice}</span>}
            </TableCell>
            <TableCell className="align-top text-xs">
              <Num>{dt(locale, r.quote.timestamp, r.quote.timezone)}</Num>
              {r.quote.source && <span className="block max-w-40 truncate text-[11px] text-muted-foreground">{r.quote.source}</span>}
            </TableCell>
            <TableCell className="text-end align-top">
              <Num>{formatCurrency(locale, r.marketValue, r.currency)}</Num>
            </TableCell>
            <TableCell className="text-end align-top">
              <Num tone={signTone(r.unrealizedPnl)}>{formatCurrency(locale, r.unrealizedPnl, r.currency)}</Num>
            </TableCell>
            <TableCell className="text-end align-top">
              <Num tone={signTone(r.unrealizedReturn)}>{formatPercent(locale, r.unrealizedReturn)}</Num>
            </TableCell>
            <TableCell className="text-end align-top">
              <Num>{formatPercent(locale, r.weight)}</Num>
              {r.weight === null && r.weightInCurrency !== null && (
                <span className="block text-[11px] text-muted-foreground">
                  {fmt(h.columns.weightInCurrency, { currency: r.currency })}: <Num>{formatPercent(locale, r.weightInCurrency)}</Num>
                </span>
              )}
            </TableCell>
            <TableCell className="text-end align-top">
              <Num tone={signTone(r.distanceFromHigh)}>{formatPercent(locale, r.distanceFromHigh)}</Num>
            </TableCell>
            <TableCell className="text-end align-top">
              <Num>{r.isEtf ? MISSING : formatRatio(locale, r.pe, 1)}</Num>
            </TableCell>
            <TableCell className="text-end align-top">
              <Num>{r.isEtf ? MISSING : formatRatio(locale, r.pb, 2)}</Num>
            </TableCell>
            <TableCell className="align-top">
              {r.isEtf ? (
                <div className="flex max-w-56 flex-col gap-1 text-xs whitespace-normal">
                  <Badge variant="muted">{dict.common.status.NOT_APPLICABLE}</Badge>
                  <span className="text-muted-foreground">{h.etf.grahamNotApplicable}</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  <ScreenCell s={r.screens.defensive} label={h.screens.defensive} dict={dict} />
                  <ScreenCell s={r.screens.enterprising} label={h.screens.enterprising} dict={dict} />
                  <ScreenCell s={r.screens.netNet} label={h.screens.netNet} dict={dict} />
                </div>
              )}
            </TableCell>
            <TableCell className="align-top text-xs">
              {r.isEtf ? (
                <EtfCell r={r} locale={locale} dict={dict} />
              ) : (
                <dl className="grid grid-cols-[auto_auto] gap-x-2">
                  <dt className="text-muted-foreground">{fmt(h.ceiling, { strategy: dict.decision.strategies[r.valuation.strategy] })}</dt>
                  <dd>
                    <Num>{formatCurrency(locale, r.valuation.ceiling, r.valuation.currency ?? r.currency)}</Num>
                  </dd>
                  <dt className="text-muted-foreground">{h.intrinsic}</dt>
                  <dd>
                    <Num>{formatCurrency(locale, r.valuation.intrinsicValue, r.valuation.currency ?? r.currency)}</Num>
                  </dd>
                  <dt className="text-muted-foreground">{h.mosTargetPrice}</dt>
                  <dd>
                    <Num>{formatCurrency(locale, r.valuation.marginOfSafetyTargetPrice, r.valuation.currency ?? r.currency)}</Num>
                  </dd>
                </dl>
              )}
            </TableCell>
            <TableCell className="align-top">
              <CategoryBadge category={r.decision.category} dict={dict} />
            </TableCell>
            <TableCell className="align-top">
              <div className="flex flex-col gap-1">
                <QuoteStatusBadge status={r.freshness.quote} dict={dict} />
                {!r.isEtf && r.market === "US" && (
                  <Badge variant={r.freshness.fundamentals === "FRESH" ? "positive" : r.freshness.fundamentals === "STALE" || r.freshness.fundamentals === "CONFLICTED" ? "negative" : "muted"} className="font-normal">
                    {dict.stock.tabs.financials}: {dict.market.status[r.freshness.fundamentals]}
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="align-top">
              <RemoveHoldingButton id={r.id} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EtfCell({ r, locale, dict }: { r: HoldingRow; locale: Locale; dict: Dictionary }) {
  const e = dict.holdings.portfolio.etf;
  const m = r.etf;
  if (!m || (m.distributionYieldTtm === null && m.totalReturn1y === null && m.yearHigh === null)) return <span className="block max-w-48 whitespace-normal text-muted-foreground">{e.none}</span>;
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-2" data-testid="etf-metrics">
      <dt className="text-muted-foreground">{e.yield}</dt>
      <dd>
        <Num>{formatPercent(locale, m.distributionYieldTtm, 2)}</Num>
      </dd>
      <dt className="text-muted-foreground">{e.tr1y}</dt>
      <dd>
        <Num tone={signTone(m.totalReturn1y)}>{formatPercent(locale, m.totalReturn1y)}</Num>
      </dd>
      <dt className="text-muted-foreground">{e.tr3y}</dt>
      <dd>
        <Num tone={signTone(m.totalReturn3y)}>{formatPercent(locale, m.totalReturn3y)}</Num>
      </dd>
      <dt className="text-muted-foreground">{e.range}</dt>
      <dd>
        <Num>{`${formatCurrency(locale, m.yearLow, r.currency)} – ${formatCurrency(locale, m.yearHigh, r.currency)}`}</Num>
      </dd>
      {m.excludedDistributions > 0 && <dd className="col-span-2 text-[11px] text-muted-foreground">{fmt(e.excluded, { n: m.excludedDistributions })}</dd>}
      <dd className="col-span-2 max-w-48 text-[11px] whitespace-normal text-muted-foreground">{e.note}</dd>
    </dl>
  );
}
