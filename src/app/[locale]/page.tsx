import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/finance/metric-card";
import { PageHeader } from "@/components/finance/page-header";
import { CardsSkeleton, EmptyState } from "@/components/finance/states";
import { DevFixtureBadge, StatusBadge } from "@/components/finance/badges";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveLocale } from "@/lib/i18n/server";
import type { Dictionary, Locale } from "@/lib/i18n";
import { securityPath } from "@/lib/i18n/paths";
import { formatDate } from "@/lib/format";
import { db } from "@/server/db";
import { providerStatuses } from "@/lib/providers/registry";
import type { ScreenResult } from "@/lib/graham/types";

export default async function OverviewPage({ params }: PageProps<"/[locale]">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.overview.title} subtitle={dict.overview.subtitle} />
      <Suspense fallback={<CardsSkeleton />}>
        <Counts locale={locale} dict={dict} />
      </Suspense>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{dict.overview.recent}</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-40" />}>
              <Recent locale={locale} dict={dict} />
            </Suspense>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-5">
          <Suspense fallback={<Skeleton className="h-48 rounded-xl" />}>
            <GettingStarted dict={dict} />
          </Suspense>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-4 text-primary" /> {dict.overview.methodologyTitle}
              </CardTitle>
              <CardDescription>{dict.overview.methodologyBody}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{dict.common.notRecommendation}</CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

async function Counts({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [universe, withData, watch, positions] = await Promise.all([
    db.security.count(),
    db.security.count({ where: { OR: [{ priceBars: { some: {} } }, { statements: { some: {} } }] } }),
    db.watchlistItem.count(),
    db.position.count(),
  ]);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <MetricCard locale={locale} label={dict.overview.universe} value={universe} format="integer" />
      <MetricCard locale={locale} label={dict.overview.analyzed} value={withData} format="integer" />
      <MetricCard locale={locale} label={dict.overview.watchlist} value={watch} format="integer" />
      <MetricCard locale={locale} label={dict.overview.positions} value={positions} format="integer" />
    </div>
  );
}

async function Recent({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const snaps = await db.analysisSnapshot.findMany({
    where: { engine: "graham-defensive" },
    orderBy: { computedAt: "desc" },
    distinct: ["securityId"],
    take: 8,
    include: { security: { include: { exchange: true } } },
  });
  if (!snaps.length) return <EmptyState compact title={dict.overview.recentEmpty} />;
  return (
    <ul className="divide-y">
      {snaps.map((s) => {
        const res = s.results as unknown as ScreenResult;
        return (
          <li key={s.id} className="flex items-center gap-3 py-2.5">
            <Link href={securityPath(locale, s.security.exchange.code, s.security.ticker)} className="w-20 shrink-0 font-mono font-semibold hover:underline" dir="ltr">
              {s.security.ticker}
            </Link>
            <span className="min-w-0 flex-1 truncate text-sm">{locale === "he" && s.security.nameHe ? s.security.nameHe : s.security.name}</span>
            {s.usesDevFixtureData && <DevFixtureBadge dict={dict} />}
            <Badge variant="outline" className="font-normal">
              {res.passed}/{res.rules.filter((r) => r.counted !== false).length}
            </Badge>
            <StatusBadge status={res.outcome === "MEETS_ALL" ? "PASS" : res.outcome === "FAILS_ONE_OR_MORE" ? "FAIL" : "INSUFFICIENT_DATA"} dict={dict} />
            <span className="hidden w-28 text-end text-xs text-muted-foreground sm:block">{formatDate(locale, s.computedAt.toISOString())}</span>
          </li>
        );
      })}
    </ul>
  );
}

async function GettingStarted({ dict }: { dict: Dictionary }) {
  const providers = providerStatuses();
  const [universe, withData] = await Promise.all([db.security.count({ where: { source: { key: "sec-edgar" } } }), db.financialStatement.count()]);
  const done = [providers.find((p) => p.key === "sec-edgar")?.configured ?? false, universe > 0, withData > 0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.overview.gettingStarted}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2.5 text-sm">
          {dict.overview.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              {done[i] ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <span className={done[i] ? "text-muted-foreground line-through" : ""}>{s}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
