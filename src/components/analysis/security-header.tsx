import { Badge } from "@/components/ui/badge";
import { DevFixtureBadge, FreshnessBadge } from "@/components/finance/badges";
import { Num, signTone } from "@/components/finance/num";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { SecurityAnalysis } from "@/server/analysis";

export function SecurityHeader({ a, dict, locale, actions }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale; actions?: React.ReactNode }) {
  const s = a.security;
  const h = a.priceHistory;
  const prev = h.length > 1 ? h[h.length - 2].close : null;
  const change = a.price && prev ? a.price.value / prev - 1 : null;
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
        <div className="flex items-baseline gap-3">
          <Num className="text-3xl font-semibold">{formatCurrency(locale, a.price?.value, a.price?.currency ?? "USD")}</Num>
          {change !== null && <Num tone={signTone(change)}>{(change > 0 ? "+" : "") + formatPercent(locale, change, 2)}</Num>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {dict.common.asOf} {formatDate(locale, a.price?.date)}
          </span>
          <FreshnessBadge level={a.freshness.prices.level} dict={dict} label={dict.stock.price} />
          <FreshnessBadge level={a.freshness.fundamentals.level} dict={dict} label={dict.nav.financials} />
        </div>
        {actions && <div className="flex flex-wrap items-start gap-2">{actions}</div>}
      </div>
    </div>
  );
}
