import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { DevFixtureBadge, MethodologyBadge } from "@/components/finance/badges";
import { ScreenStrip } from "@/components/finance/rule-list";
import { Num } from "@/components/finance/num";
import { Badge } from "@/components/ui/badge";
import { resolveLocale } from "@/lib/i18n/server";
import { href, securityPath } from "@/lib/i18n/paths";
import type { Dictionary, Locale } from "@/lib/i18n";
import { formatCurrency, formatRatio } from "@/lib/format";
import { db } from "@/server/db";
import { getSecurityAnalysis } from "@/server/analysis";

const MAX_ROWS = 100;

export default async function ScreeningPage({ params, searchParams }: PageProps<"/[locale]/screening">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.screening.title} subtitle={dict.screening.subtitle} actions={<MethodologyBadge methodology="GRAHAM_1973" dict={dict} />} />
      <Suspense fallback={<PageSkeleton />}>
        <Results locale={locale} dict={dict} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ locale, dict, searchParams }: { locale: Locale; dict: Dictionary; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = (await searchParams).filter === "meets" ? "meets" : "all";
  const ids = await db.security.findMany({ where: { statements: { some: {} } }, select: { id: true }, orderBy: { ticker: "asc" }, take: MAX_ROWS });
  if (!ids.length) return <EmptyState title={dict.screening.empty} />;
  const analyses = (await Promise.all(ids.map((i) => getSecurityAnalysis(i.id)))).filter((a) => a !== null);
  const rows = analyses
    // A screen result is only a conclusion when the data behind it passed the sufficiency gate.
    .filter((a) => filter === "all" || (a.defensive.outcome === "MEETS_ALL" && a.health.gate.sufficient))
    .sort((x, y) => y.defensive.passed - x.defensive.passed || y.enterprising.passed - x.enterprising.passed);
  const base = href(locale, "/screening");
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{dict.screening.filter}:</span>
          <Button asChild size="sm" variant={filter === "all" ? "secondary" : "ghost"}>
            <Link href={base}>{dict.screening.filterAll}</Link>
          </Button>
          <Button asChild size="sm" variant={filter === "meets" ? "secondary" : "ghost"}>
            <Link href={`${base}?filter=meets`}>{dict.screening.filterMeets}</Link>
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{dict.screening.columns.security}</TableHead>
              <TableHead>{dict.screening.columns.defensive}</TableHead>
              <TableHead>{dict.screening.columns.enterprising}</TableHead>
              <TableHead className="text-end">{dict.screening.columns.price}</TableHead>
              <TableHead className="text-end">{dict.screening.columns.pe}</TableHead>
              <TableHead className="text-end">{dict.screening.columns.pb}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const pe = a.defensive.rules.find((r) => r.id === "defensive.moderatePe")?.measured.pe3y ?? null;
              const pb = a.defensive.rules.find((r) => r.id === "defensive.moderatePriceToAssets")?.measured.priceToBook ?? null;
              return (
                <TableRow key={a.security.id}>
                  <TableCell>
                    <Link href={securityPath(locale, a.security.exchangeCode, a.security.ticker)} className="flex items-center gap-2 hover:underline">
                      <span className="font-mono font-semibold" dir="ltr">
                        {a.security.ticker}
                      </span>
                      <span className="max-w-56 truncate text-muted-foreground">{locale === "he" && a.security.nameHe ? a.security.nameHe : a.security.name}</span>
                      {a.freshness.usesDevFixtureData && <DevFixtureBadge dict={dict} />}
                    </Link>
                    {!a.health.gate.sufficient && (
                      <Badge variant="negative" className="mt-1 font-normal">
                        {dict.health.insufficient}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ScreenStrip screen={a.defensive} dict={dict} />
                      <Badge variant="outline" className="font-mono font-normal">
                        {a.defensive.passed}/{a.defensive.rules.length}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ScreenStrip screen={a.enterprising} dict={dict} />
                      <Badge variant="outline" className="font-mono font-normal">
                        {a.enterprising.passed}/{a.enterprising.rules.length}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-end">
                    <Num>{formatCurrency(locale, a.price?.value, a.price?.currency ?? "USD")}</Num>
                  </TableCell>
                  <TableCell className="text-end">
                    <Num>{formatRatio(locale, pe, 1)}</Num>
                  </TableCell>
                  <TableCell className="text-end">
                    <Num>{formatRatio(locale, pb, 2)}</Num>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 && <EmptyState compact title={dict.common.noData} />}
      </CardContent>
    </Card>
  );
}
