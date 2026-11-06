import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/finance/page-header";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { ComparisonView } from "@/components/analysis/decision-panel";
import { resolveLocale } from "@/lib/i18n/server";
import { href, securityPath } from "@/lib/i18n/paths";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { db } from "@/server/db";
import { compareStored, DECISION_SNAPSHOT_ENGINE, listDecisionSnapshots } from "@/server/decision";

type Search = Record<string, string | string[] | undefined>;

export default async function HistoryPage({ params, searchParams }: PageProps<"/[locale]/history">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.holdings.history.title} subtitle={dict.holdings.history.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content locale={locale} dict={dict} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

async function Content({ locale, dict, searchParams }: { locale: Locale; dict: Dictionary; searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const t = dict.holdings.history;
  const s = dict.decision.snapshots;
  const counts = await db.analysisSnapshot.groupBy({ by: ["securityId"], where: { engine: DECISION_SNAPSHOT_ENGINE }, _count: { _all: true } });
  if (counts.length === 0) return <EmptyState title={t.noSnapshots} />;
  const securities = await db.security.findMany({ where: { id: { in: counts.map((c) => c.securityId) } }, include: { exchange: true }, orderBy: { ticker: "asc" } });
  const countOf = new Map(counts.map((c) => [c.securityId, c._count._all]));
  const selected = securities.find((x) => x.id === str(sp.security)) ?? securities[0];
  const snapshots = await listDecisionSnapshots(selected.id);
  const fromSnap = snapshots.find((x) => x.id === str(sp.from)) ?? snapshots[1];
  const toSnap = snapshots.find((x) => x.id === str(sp.to)) ?? snapshots[0];
  const comparison = fromSnap && toSnap && fromSnap.id !== toSnap.id ? compareStored(fromSnap, toSnap) : null;
  const currency = toSnap?.snapshot.inputs.price?.currency ?? null;
  const dt = (iso: string) => formatDate(locale, iso, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.security}</CardTitle>
          <CardDescription>{t.pick}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form method="get" action={href(locale, "/history")} className="flex flex-wrap items-end gap-2" data-testid="history-security-form">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t.security}</span>
              <NativeSelect name="security" defaultValue={selected.id}>
                {securities.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.ticker} · {x.exchange.code} · {fmt(t.snapshots, { n: countOf.get(x.id) ?? 0 })}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button type="submit" size="sm" variant="outline">
              {s.compare}
            </Button>
          </form>
          {snapshots.length >= 2 && (
            <form method="get" action={href(locale, "/history")} className="flex flex-wrap items-end gap-2" data-testid="history-compare-form">
              <input type="hidden" name="security" value={selected.id} />
              {(["from", "to"] as const).map((side) => (
                <label key={side} className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">{s[side]}</span>
                  <NativeSelect name={side} defaultValue={(side === "from" ? fromSnap : toSnap)?.id}>
                    {snapshots.map((x) => (
                      <option key={x.id} value={x.id}>
                        {dt(x.snapshot.createdAt)} · {dict.decision.categories[x.snapshot.assessment.category]}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ))}
              <Button type="submit" size="sm" variant="outline">
                {s.compare}
              </Button>
            </form>
          )}
          <Link className="text-xs underline underline-offset-2" href={`${securityPath(locale, selected.exchange.code, selected.ticker)}?tab=decision`}>
            {t.open}
          </Link>
        </CardContent>
      </Card>

      <Card data-testid="history-comparison">
        <CardHeader>
          <CardTitle className="text-base">
            {selected.ticker} · {selected.name}
          </CardTitle>
          {comparison && (
            <CardDescription>
              {dt(comparison.from.createdAt)} → {dt(comparison.to.createdAt)}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>{comparison ? <ComparisonView c={comparison} dict={dict} locale={locale} currency={currency} /> : <p className="text-sm text-muted-foreground">{s.needTwo}</p>}</CardContent>
      </Card>
    </div>
  );
}
