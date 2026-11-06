import Link from "next/link";
import { Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MethodologyBadge } from "@/components/finance/badges";
import { formatCurrency, formatPercent } from "@/lib/format";
import { fmt, lookup, type Dictionary, type Locale } from "@/lib/i18n";
import { IMPLIED_GROWTH_RANGE, type FairValueModel, type FairValueSummary } from "@/lib/valuation/fair-value";
import type { SecurityAnalysis } from "@/server/analysis";
import { cn } from "@/lib/utils";

/** Fill a template, wrapping every value in an LTR isolate so prices and signed % read correctly inside Hebrew text. */
function fmtLtr(template: string, vars: Record<string, string | number>): React.ReactNode {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in vars ? (
      <bdi key={i} dir="ltr" className="num">
        {vars[m[1]]}
      </bdi>
    ) : (
      part
    );
  });
}

const signed = (locale: Locale, v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${formatPercent(locale, v, 0)}`);

/**
 * Bottom-line card shown above the analysis tabs: market price, blended fair
 * value range, the % gap, a range bar with every scenario, and what the price
 * implies. All numbers come from `buildFairValue` (src/lib/valuation/fair-value.ts).
 */
export function FairValueCard({ a, dict, locale, gated = false }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale; gated?: boolean }) {
  const t = dict.fairValue;
  const fv = a.fairValue;
  const currency = fv.currency ?? a.price?.currency ?? "USD";
  const money = (v: number | null) => formatCurrency(locale, v, currency);
  const priceWarning = a.valuationDashboard.price.warning;
  const iv = a.intrinsic.result;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="size-5" /> {t.title}
        </CardTitle>
        <CardDescription>{t.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {gated && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{t.flags.gated}</p>}

        <div className="grid gap-4 sm:grid-cols-3">
          <Figure label={t.marketPrice} value={fv.price !== null ? money(fv.price) : money(a.price?.value ?? null)} />
          <Figure
            label={t.fairValue}
            value={fv.status === "ESTABLISHED" ? money(fv.base) : "—"}
            sub={fv.status === "ESTABLISHED" ? fmtLtr(t.range, { range: `${money(fv.low)} – ${money(fv.high)}` }) : undefined}
          />
          <Figure
            label={t.gapLabel}
            value={signed(locale, fv.gap)}
            tone={fv.gap === null ? undefined : fv.gap > 0 ? "positive" : "negative"}
            sub={fv.gapLow !== null && fv.gapHigh !== null ? fmtLtr(t.gapRange, { low: signed(locale, fv.gapLow), high: signed(locale, fv.gapHigh) }) : undefined}
          />
        </div>

        {fv.status !== "ESTABLISHED" ? (
          <p className="text-sm text-muted-foreground">{t.noModel}</p>
        ) : fv.price === null ? (
          <p className="text-sm text-muted-foreground">{t.noPrice}</p>
        ) : (
          <>
            {fv.verdict && <p className="text-base font-medium">{fmtLtr(t.verdict[fv.verdict], { pct: formatPercent(locale, Math.abs(fv.gap!), 0) })}</p>}
            <RangeBar fv={fv} t={t} money={money} />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <div className="font-medium">{t.scenarios.title}</div>
                <div className={cn("num mt-1 text-2xl font-semibold", fv.scenarios.above > fv.scenarios.total / 2 ? "text-positive" : "text-negative")}>
                  {fmtLtr(t.scenarios.count, { above: fv.scenarios.above, total: fv.scenarios.total })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.scenarios.note}</p>
              </div>
              <ImpliedGrowth fv={fv} t={t} locale={locale} />
            </div>
          </>
        )}

        {priceWarning && priceWarning !== "noPrice" && (
          <p className="text-xs text-warning">{fmt(dict.valuationDashboard.price.warning[priceWarning], { days: a.valuationDashboard.price.ageDays ?? "" })}</p>
        )}
        {(["cashFlowBelowEarnings", "modelsDisagree", "terminalHeavy", "assetBasedOnly"] as const)
          .filter((k) => fv.flags[k])
          .map((k) => (
            <p key={k} className="text-xs text-warning">
              {t.flags[k]}
            </p>
          ))}

        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{t.models.title}</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {fv.models.map((m) => (
              <ModelRow key={m.id} m={m} dict={dict} money={money} />
            ))}
          </ul>
          {iv.status === "ESTABLISHED" && (
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtLtr(t.assumptions, { r: formatPercent(locale, iv.assumptions.discountRate, 0), g: formatPercent(locale, iv.assumptions.revenueGrowth, 1) })}
            </p>
          )}
        </details>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t.disclaimer}</span>
          <Link href="?tab=valuation" className="text-sm text-foreground underline underline-offset-2">
            {t.details}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: "positive" | "negative" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <bdi dir="ltr" className={cn("num w-fit font-mono text-3xl font-bold", tone === "positive" && "text-positive", tone === "negative" && "text-negative")}>
        {value}
      </bdi>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** Horizontal value scale (always left → right): value range band, estimate tick, price marker, one dot per scenario. */
function RangeBar({ fv, t, money }: { fv: FairValueSummary; t: Dictionary["fairValue"]; money: (v: number | null) => string }) {
  const price = fv.price!;
  const pts = [fv.low!, fv.high!, price, ...fv.scenarios.values];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = (hi - lo) * 0.06 || hi * 0.1;
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <div dir="ltr" className="flex flex-col gap-1" aria-label={t.bar.range}>
      <div className="relative h-14">
        {/* scenario dots */}
        {fv.scenarios.values.map((v, i) => (
          <span
            key={i}
            className={cn("absolute top-1 size-2 -translate-x-1/2 rounded-full opacity-70", v > price ? "bg-positive" : "bg-negative")}
            style={{ left: pos(v), top: `${4 + (i % 3) * 5}px` }}
          />
        ))}
        {/* value range band */}
        <div className="absolute top-6 h-3 rounded-full bg-primary/25" style={{ left: pos(fv.low!), width: `calc(${pos(fv.high!)} - ${pos(fv.low!)})` }} />
        <div className="absolute top-5 h-5 w-1 -translate-x-1/2 rounded bg-primary" style={{ left: pos(fv.base!) }} />
        {/* price marker */}
        <div className="absolute top-3 h-9 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: pos(price) }} />
        <div className="absolute inset-x-0 top-[1.85rem] h-px bg-border" />
      </div>
      <div className="relative h-8 text-xs">
        <Label left={pos(fv.base!)} className="text-primary">
          {t.bar.estimate} {money(fv.base)}
        </Label>
        <Label left={pos(price)} className="top-4 font-semibold">
          {t.bar.price} {money(price)}
        </Label>
      </div>
    </div>
  );
}

function Label({ left, className, children }: { left: string; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("num absolute -translate-x-1/2 whitespace-nowrap font-mono", className)} style={{ left: `clamp(3.5rem, ${left}, calc(100% - 3.5rem))` }}>
      {children}
    </span>
  );
}

function ImpliedGrowth({ fv, t, locale }: { fv: FairValueSummary; t: Dictionary["fairValue"]; locale: Locale }) {
  const ig = fv.impliedGrowth;
  if (ig.value === null && ig.outOfRange === null) return null;
  const years = ig.years ?? 10;
  const assumed = ig.assumed === null ? "—" : formatPercent(locale, ig.assumed, 1);
  const text =
    ig.outOfRange === "ABOVE"
      ? fmtLtr(t.implied.above, { pct: formatPercent(locale, IMPLIED_GROWTH_RANGE[1], 0), years, assumed })
      : ig.outOfRange === "BELOW"
        ? fmtLtr(t.implied.below, { pct: formatPercent(locale, -IMPLIED_GROWTH_RANGE[0], 0) })
        : fmtLtr(t.implied.value, { pct: formatPercent(locale, ig.value!, 0), years, assumed });
  return (
    <div className="rounded-md bg-muted/50 p-3 text-sm">
      <div className="font-medium">{t.implied.title}</div>
      <p className="mt-1">{text}</p>
      {ig.historical !== null && <p className="mt-1 text-xs text-muted-foreground">{fmtLtr(t.implied.historical, { hist: formatPercent(locale, ig.historical, 0) })}</p>}
    </div>
  );
}

function ModelRow({ m, dict, money }: { m: FairValueModel; dict: Dictionary; money: (v: number | null) => string }) {
  const t = dict.fairValue.models;
  const reasons = { ...dict.valuationDashboard.intrinsic.reasons, ...t.reasons } as Record<string, string>;
  const reason = lookup(reasons, m.reason);
  return (
    <li className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.names[m.id]}</span>
        <MethodologyBadge methodology={m.methodology} dict={dict} />
        <Badge variant={m.role === "USED" ? "positive" : "muted"}>{t.roles[m.role]}</Badge>
        {m.value !== null && (
          <bdi dir="ltr" className="num ms-auto font-mono">
            {money(m.value)}
            {m.role === "USED" && m.low !== null && m.high !== null && m.low !== m.high ? ` (${money(m.low)} – ${money(m.high)})` : ""}
          </bdi>
        )}
      </div>
      {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
    </li>
  );
}
