import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState } from "@/components/finance/states";
import { DevFixtureBadge } from "@/components/finance/badges";
import { SecuritySearch } from "@/components/layout/security-search";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveLocale } from "@/lib/i18n/server";
import { href, securityPath } from "@/lib/i18n/paths";
import type { Dictionary, Locale } from "@/lib/i18n";
import { listExchanges } from "@/server/securities";
import { db } from "@/server/db";

export default async function StocksPage({ params }: PageProps<"/[locale]/stocks">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.stock.searchTitle} subtitle={dict.stock.searchSubtitle} />
      <Suspense fallback={<Skeleton className="h-11 max-w-2xl" />}>
        <HeroSearch />
      </Suspense>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{dict.overview.analyzed}</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-32" />}>
            <WithData locale={locale} dict={dict} />
          </Suspense>
        </CardContent>
      </Card>
    </>
  );
}

async function HeroSearch() {
  const exchanges = (await listExchanges()).filter((e) => e._count.securities > 0).map((e) => e.code);
  return <SecuritySearch variant="hero" exchanges={exchanges} />;
}

async function WithData({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const rows = await db.security.findMany({
    where: { OR: [{ priceBars: { some: {} } }, { statements: { some: {} } }] },
    include: { exchange: true, source: true },
    orderBy: { ticker: "asc" },
    take: 60,
  });
  if (!rows.length)
    return <EmptyState compact title={dict.overview.recentEmpty} body={<Link className="underline" href={href(locale, "/data-health")}>{dict.nav.dataHealth}</Link>} />;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <Link key={r.id} href={securityPath(locale, r.exchange.code, r.ticker)} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60">
          <span className="font-mono font-semibold" dir="ltr">
            {r.ticker}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{locale === "he" && r.nameHe ? r.nameHe : r.name}</span>
          {r.source?.isDevFixture && <DevFixtureBadge dict={dict} />}
          <span className="font-mono text-xs text-muted-foreground">{r.exchange.code}</span>
        </Link>
      ))}
    </div>
  );
}
