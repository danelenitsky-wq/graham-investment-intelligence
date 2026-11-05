import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MousePointerClick } from "lucide-react";
import { SecuritySearch } from "@/components/layout/security-search";
import { DevFixtureBanner } from "@/components/finance/badges";
import { EmptyState, PageSkeleton } from "@/components/finance/states";
import { SecurityHeader } from "./security-header";
import { parseSymbolParam } from "@/lib/i18n/paths";
import type { Dictionary, Locale } from "@/lib/i18n";
import { findSecurity, getSecurityAnalysis, type SecurityAnalysis } from "@/server/analysis";

/**
 * Shared layout for pages that operate on one security chosen via ?s=EXCHANGE:TICKER
 * (Valuation, Financial History).
 */
export function SecurityPickerPage({
  locale,
  dict,
  basePath,
  searchParams,
  pickText,
  render,
}: {
  locale: Locale;
  dict: Dictionary;
  basePath: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  pickText: string;
  render: (a: SecurityAnalysis) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SecuritySearch variant="hero" linkTo={basePath} />
      <Suspense fallback={<PageSkeleton />}>
        <Selected locale={locale} dict={dict} searchParams={searchParams} pickText={pickText} render={render} />
      </Suspense>
    </div>
  );
}

async function Selected({
  locale,
  dict,
  searchParams,
  pickText,
  render,
}: {
  locale: Locale;
  dict: Dictionary;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  pickText: string;
  render: (a: SecurityAnalysis) => React.ReactNode;
}) {
  const sp = await searchParams;
  const sym = parseSymbolParam(sp.s);
  if (!sym) return <EmptyState icon={MousePointerClick} title={pickText} />;
  const security = await findSecurity(sym.exchange, sym.ticker);
  if (!security) notFound();
  const g = typeof sp.g === "string" && sp.g.trim() !== "" && Number.isFinite(Number(sp.g)) ? Number(sp.g) : null;
  const a = await getSecurityAnalysis(security.id, { growthPercentOverride: g });
  if (!a) notFound();
  return (
    <>
      {a.freshness.usesDevFixtureData && <DevFixtureBanner dict={dict} />}
      <SecurityHeader a={a} dict={dict} locale={locale} />
      {render(a)}
    </>
  );
}
