import { Badge } from "@/components/ui/badge";
import { DevFixtureBadge, FreshnessBadge } from "@/components/finance/badges";
import { LiveQuote } from "@/components/analysis/live-quote";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import type { SecurityAnalysis } from "@/server/analysis";

export function SecurityHeader({ a, dict, locale, actions }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale; actions?: React.ReactNode }) {
  const s = a.security;
  return (
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-bold tracking-tight" dir="ltr">
            {s.ticker}
          </h1>
          <Badge variant="outline">{s.exchangeCode}</Badge>
          {s.isUtility && <Badge variant="info">{dict.stock.utility}</Badge>}
          {a.freshness.usesDevFixtureData && <DevFixtureBadge dict={dict} />}
        </div>
        <div className="mt-1 truncate text-sm text-muted-foreground">{locale === "he" && s.nameHe ? s.nameHe : s.name}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {s.cik && (
            <span>
              {dict.stock.cik}: <span className="num font-mono">{s.cik}</span>
            </span>
          )}
          {s.sector && (
            <span>
              {dict.stock.sector}: {s.sector}
            </span>
          )}
          {s.reportingCurrency && (
            <span>
              {dict.stock.reportingCurrency}: <span className="font-mono">{s.reportingCurrency}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 lg:items-end">
        <LiveQuote initial={a.quote} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{fmt(dict.market.timesIn, { tz: a.quote.timezone })}</span>
          <FreshnessBadge level={a.freshness.fundamentals.level} dict={dict} label={dict.nav.financials} />
        </div>
        {actions && <div className="flex flex-wrap items-start gap-2">{actions}</div>}
      </div>
    </div>
  );
}
