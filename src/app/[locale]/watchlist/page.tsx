import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { DevFixtureBadge, FreshnessBadge } from "@/components/finance/badges";
import { ScreenStrip } from "@/components/finance/rule-list";
import { WatchlistButton } from "@/components/finance/action-buttons";
import { Num, signTone } from "@/components/finance/num";
import { resolveLocale } from "@/lib/i18n/server";
import { securityPath } from "@/lib/i18n/paths";
import type { Dictionary, Locale } from "@/lib/i18n";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { priceFreshness } from "@/lib/freshness";
import type { ScreenResult } from "@/lib/graham/types";
import { getWatchlistWithItems } from "@/server/watchlist";
import { getSettings } from "@/server/settings";

export default async function WatchlistPage({ params }: PageProps<"/[locale]/watchlist">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.watchlist.title} subtitle={dict.watchlist.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content locale={locale} dict={dict} />
      </Suspense>
    </>
  );
}

async function Content({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [{ items }, settings] = await Promise.all([getWatchlistWithItems(), getSettings()]);
  if (!items.length) return <EmptyState title={dict.watchlist.empty} />;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{dict.screening.columns.security}</TableHead>
              <TableHead className="text-end">{dict.metrics.price}</TableHead>
              <TableHead className="text-end">{dict.watchlist.dayChange}</TableHead>
              <TableHead>{dict.watchlist.defensiveOutcome}</TableHead>
              <TableHead>{dict.common.lastUpdated}</TableHead>
              <TableHead>{dict.watchlist.added}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const s = it.security;
              const [b0, b1] = s.priceBars;
              const change = b0 && b1 ? Number(b0.close) / Number(b1.close) - 1 : null;
              const snap = s.snapshots[0]?.results as unknown as ScreenResult | undefined;
              const fresh = priceFreshness(b0 ? b0.date.toISOString().slice(0, 10) : null, today, b0?.source.isDevFixture ?? false, settings.freshness);
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    <Link href={securityPath(locale, s.exchange.code, s.ticker)} className="flex items-center gap-2 hover:underline">
                      <span className="font-mono font-semibold" dir="ltr">
                        {s.ticker}
                      </span>
                      <span className="max-w-56 truncate text-muted-foreground">{locale === "he" && s.nameHe ? s.nameHe : s.name}</span>
                      {s.source?.isDevFixture && <DevFixtureBadge dict={dict} />}
                    </Link>
                  </TableCell>
                  <TableCell className="text-end">
                    <Num>{formatCurrency(locale, b0 ? Number(b0.close) : null, b0?.currency ?? s.exchange.currency)}</Num>
                  </TableCell>
                  <TableCell className="text-end">
                    <Num tone={signTone(change)}>{formatPercent(locale, change, 2)}</Num>
                  </TableCell>
                  <TableCell>
                    {snap ? (
                      <div className="flex items-center gap-2">
                        <ScreenStrip screen={snap} dict={dict} />
                        <Badge variant="outline" className="font-mono font-normal">
                          {snap.passed}/{snap.rules.filter((r) => r.counted !== false).length}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{dict.common.noData}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <FreshnessBadge level={fresh.level} dict={dict} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(locale, it.addedAt.toISOString())}</TableCell>
                  <TableCell className="text-end">
                    <WatchlistButton securityId={s.id} initial />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
