"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, Crosshair, RotateCcw, ShieldAlert } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Num, signTone } from "@/components/finance/num";
import { PriceChart } from "@/components/charts/price-chart";
import { useI18n } from "@/components/layout/providers";
import { fmt } from "@/lib/i18n";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { marginOfSafety, type CeilingRow, type ValuationDashboard } from "@/lib/valuation/engine";
import {
  computeIntrinsicValue,
  INTRINSIC_LIMITS,
  type AssumptionDefaults,
  type IntrinsicAssumptions,
  type IntrinsicBase,
  type IntrinsicMethod,
  type IntrinsicResult,
} from "@/lib/valuation/intrinsic";

type Props = {
  dashboard: ValuationDashboard;
  intrinsic: { base: IntrinsicBase; defaults: AssumptionDefaults };
  marginOfSafetyTarget: number;
  priceHistory: { date: string; close: number }[];
};

type CeilingKey = "grahamNumber" | "defensive" | "enterprising" | "netNet";
const CEILING_KEYS: CeilingKey[] = ["grahamNumber", "defensive", "enterprising", "netNet"];
const COLORS: Record<CeilingKey | "intrinsic", string> = {
  grahamNumber: "var(--color-chart-5)",
  defensive: "var(--color-chart-1)",
  enterprising: "var(--color-chart-3)",
  netNet: "var(--color-chart-4)",
  intrinsic: "var(--color-chart-2)",
};

/** Interactive valuation dashboard (assumptions and margin-of-safety target recompute live in the browser). */
export function ValuationDashboardView({ dashboard, intrinsic, marginOfSafetyTarget, priceHistory }: Props) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard;
  const currency = dashboard.currency ?? dashboard.price.price?.currency ?? "USD";
  const [assumptions, setAssumptions] = useState<IntrinsicAssumptions>(intrinsic.defaults.assumptions);
  const [target, setTarget] = useState(marginOfSafetyTarget);
  const result = useMemo(() => computeIntrinsicValue(intrinsic.base, assumptions), [intrinsic.base, assumptions]);
  const price = dashboard.price.comparable;
  const mos = useMemo(() => marginOfSafety(result, price, target), [result, price, target]);
  const money = (v: number | null | undefined) => formatCurrency(locale, v ?? null, currency);

  return (
    <div className="flex flex-col gap-5">
      <PriceCard dashboard={dashboard} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CEILING_KEYS.map((k) => (
          <CeilingCard key={k} id={k} row={dashboard[k]} currency={currency} extra={k === "netNet" ? dashboard.netNet.ncavPerShare : undefined} />
        ))}
        <IntrinsicSummaryCard result={result} currency={currency} price={price} />
        <Card className={cn("gap-3", mos.status === "ESTABLISHED" && (mos.meetsTarget ? "border-positive/40" : "border-negative/30"))}>
          <CardHeader>
            <CardTitle className="text-sm">{t.cards.marginOfSafety}</CardTitle>
            <CardDescription>
              <code dir="ltr" className="text-[11px]">
                {t.mos.formula}
              </code>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {mos.status === "ESTABLISHED" && mos.percent !== null ? (
              <Num className="text-2xl font-semibold" tone={signTone(mos.percent)}>
                {formatPercent(locale, mos.percent / 100)}
              </Num>
            ) : (
              <span className="text-xl font-semibold text-warning">{t.mos.notEstablished}</span>
            )}
            {mos.reason !== "computed" && <p className="text-xs text-muted-foreground">{t.mos.reasons[mos.reason]}</p>}
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex items-center justify-between">
                <span className="text-muted-foreground">{t.mos.target}</span>
                <Num>{formatPercent(locale, target, 0)}</Num>
              </span>
              <input type="range" min={0} max={90} step={5} value={Math.round(target * 100)} onChange={(e) => setTarget(Number(e.target.value) / 100)} className="accent-primary" dir="ltr" aria-label={t.mos.target} />
            </label>
            <p className="text-[11px] text-muted-foreground">{t.mos.targetNote}</p>
            {mos.targetPrice !== null && (
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{t.mos.targetPrice}</span>
                <Num>{money(mos.targetPrice)}</Num>
              </div>
            )}
            {mos.status === "ESTABLISHED" && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <Badge variant={mos.meetsTarget ? "positive" : "negative"}>{mos.meetsTarget ? t.mos.meets : t.mos.misses}</Badge>
                <span className="text-muted-foreground">
                  {t.changeRequired}: <Num tone={signTone(mos.changeRequired)}>{formatPercent(locale, mos.changeRequired)}</Num>
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ValuationChart dashboard={dashboard} result={result} targetPrice={mos.targetPrice} currency={currency} priceHistory={priceHistory} />

      <IntrinsicPanel defaults={intrinsic.defaults} assumptions={assumptions} setAssumptions={setAssumptions} result={result} currency={currency} price={price} target={target} />
    </div>
  );
}

// ─────────────────────────────── price ───────────────────────────────

function PriceCard({ dashboard }: { dashboard: ValuationDashboard }) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard;
  const p = dashboard.price;
  const historical = p.basis !== "CURRENT";
  const warning = p.warning ? fmt(t.price.warning[p.warning], { days: p.ageDays ?? "—" }) : null;
  return (
    <Card className={cn("gap-3", historical && "border-warning/50")}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            {t.price.title}
            <Badge variant={p.basis === "CURRENT" ? "positive" : p.basis === "HISTORICAL" ? "warning" : "muted"}>{t.price.basis[p.basis]}</Badge>
            {p.price?.quoteStatus && <Badge variant="outline">{dict.market.status[p.price.quoteStatus]}</Badge>}
          </CardTitle>
          <Num className="text-3xl font-semibold">{formatCurrency(locale, p.price?.value ?? null, p.price?.currency ?? dashboard.currency ?? "USD")}</Num>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t.price.tradingDate}</dt>
          <dd>
            <Num>{p.price ? formatDate(locale, p.price.date) : "—"}</Num>
            {p.ageDays !== null && p.ageDays > 0 && <span className="ms-1 text-muted-foreground">({fmt(t.price.ageDays, { days: p.ageDays })})</span>}
          </dd>
          <dt className="text-muted-foreground">{t.price.timestamp}</dt>
          <dd>
            <Num>{p.price?.timestamp ? `${new Date(p.price.timestamp).toLocaleString(dict.meta.localeTag, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC` : "—"}</Num>
          </dd>
          <dt className="text-muted-foreground">{t.price.source}</dt>
          <dd>{p.price?.source ?? "—"}</dd>
        </dl>
      </CardHeader>
      {warning && (
        <CardContent>
          <Alert variant={historical || p.basis === "UNAVAILABLE" ? "warning" : "default"}>
            <AlertTriangle />
            <AlertTitle>{t.price.basis[p.basis]}</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        </CardContent>
      )}
    </Card>
  );
}

// ─────────────────────────────── ceilings ───────────────────────────────

function StatusPill({ status }: { status: "ESTABLISHED" | "NOT_ESTABLISHED" | "NOT_APPLICABLE" | "DISABLED" }) {
  const { dict } = useI18n();
  const variant = status === "ESTABLISHED" ? "positive" : status === "NOT_ESTABLISHED" ? "warning" : "muted";
  return <Badge variant={variant}>{dict.valuationDashboard.status[status]}</Badge>;
}

function UnverifiedBadge() {
  const { dict } = useI18n();
  return (
    <Badge variant="warning" className="font-semibold" title={dict.valuationDashboard.notes.unverified}>
      <ShieldAlert /> {dict.graham.verification.UNVERIFIED}
    </Badge>
  );
}

function ComparisonLine({ row }: { row: CeilingRow }) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard;
  const c = row.comparison;
  if (row.ceiling.status !== "ESTABLISHED") return null;
  if (c.changeRequired === null) return <div className="text-xs text-muted-foreground">{t.noComparison}</div>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <Badge variant={c.withinThreshold ? "positive" : "negative"}>{c.withinThreshold ? t.withinThreshold : t.aboveThreshold}</Badge>
      <span className="text-muted-foreground" title={t.changeRequiredHint}>
        {t.changeRequired}: <Num tone={signTone(c.changeRequired)}>{(c.changeRequired > 0 ? "+" : "") + formatPercent(locale, c.changeRequired)}</Num>
      </span>
    </div>
  );
}

function CeilingCard({ id, row, currency, extra }: { id: CeilingKey; row: CeilingRow; currency: string; extra?: number | null }) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard;
  const c = row.ceiling;
  const money = (v: number | null) => formatCurrency(locale, v, currency);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-block size-2.5 rounded-full" style={{ background: COLORS[id] }} />
          {t.cards[id]}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-1">
          <StatusPill status={c.status} />
          {c.verification === "UNVERIFIED" && c.status !== "NOT_APPLICABLE" && <UnverifiedBadge />}
          {id === "grahamNumber" && <Badge variant="outline" className="font-normal">{dict.common.methodology.GRAHAM_DERIVED}</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {c.status === "ESTABLISHED" ? (
          <Num className="text-2xl font-semibold">{(c.strict ? "< " : "≤ ") + money(c.value)}</Num>
        ) : (
          <span className="text-xl font-semibold text-warning">{t.status[c.status]}</span>
        )}
        {c.reason !== "computed" && <p className="text-xs text-muted-foreground">{t.ceilingReasons[c.reason]}</p>}
        <ComparisonLine row={row} />
        <code dir="ltr" className="text-[11px] text-muted-foreground">
          {c.formula}
        </code>
        {c.components.length > 0 && c.status !== "NOT_APPLICABLE" && (
          <ul className="flex flex-col gap-1 border-t pt-2 text-xs">
            {c.components.map((x) => (
              <li key={x.key} className={cn("flex items-center justify-between gap-2", c.binding === x.key && "font-semibold")}>
                <span className="flex items-center gap-1">
                  {c.binding === x.key && <Crosshair className="size-3" aria-label={t.binding} />}
                  {t.components[x.key as keyof typeof t.components] ?? x.key}
                  {x.verification === "UNVERIFIED" && <ShieldAlert className="size-3 text-warning" aria-label={dict.graham.verification.UNVERIFIED} />}
                </span>
                <Num>{x.value === null ? "—" : (x.strict ? "< " : "") + money(x.value)}</Num>
              </li>
            ))}
          </ul>
        )}
        {extra !== undefined && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t.cards.ncav}</span>
            <Num tone={signTone(extra)}>{money(extra)}</Num>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{t.notes[id]}</p>
        {id === "enterprising" && c.strict && <p className="text-[11px] text-muted-foreground">{t.notes.enterprisingStrict}</p>}
        {c.verification === "UNVERIFIED" && c.status !== "NOT_APPLICABLE" && <p className="text-[11px] text-warning">{t.notes.unverified}</p>}
        {row.otherCriteria && (
          <p className="text-[11px] text-muted-foreground">
            {fmt(t.notes.otherCriteria, { passed: row.otherCriteria.passed, failed: row.otherCriteria.failed, insufficient: row.otherCriteria.insufficient })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function IntrinsicSummaryCard({ result, currency, price }: { result: IntrinsicResult; currency: string; price: number | null }) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard;
  const money = (v: number | null) => formatCurrency(locale, v, currency);
  const established = result.status === "ESTABLISHED";
  const change = established && price ? (result.value! - price) / price : null;
  return (
    <Card className="gap-3 border-info/30">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-block size-2.5 rounded-full" style={{ background: COLORS.intrinsic }} />
          {t.cards.intrinsic}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-1">
          <StatusPill status={result.status} />
          <Badge variant="info" className="font-normal">
            {t.intrinsic.badge}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {established ? (
          <>
            <Num className="text-2xl font-semibold">{`${money(result.low)} – ${money(result.high)}`}</Num>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t.intrinsic.base}</span>
              <Num>{money(result.value)}</Num>
            </div>
            {change !== null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t.changeRequired}</span>
                <Num tone={signTone(change)}>{(change > 0 ? "+" : "") + formatPercent(locale, change)}</Num>
              </div>
            )}
            {result.terminalHeavy && <p className="text-[11px] text-warning">{t.intrinsic.terminalHeavy}</p>}
          </>
        ) : (
          <>
            <span className="text-xl font-semibold text-warning">{t.status.NOT_ESTABLISHED}</span>
            <p className="text-xs text-muted-foreground">{t.intrinsic.reasons[result.reason]}</p>
          </>
        )}
        <p className="text-[11px] text-muted-foreground">{t.intrinsic.methods[result.method]}</p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────── chart ───────────────────────────────

interface ChartRow {
  key: CeilingKey | "intrinsic";
  label: string;
  offset: number;
  span: number;
  low: number;
  high: number;
}

function ValuationChart({ dashboard, result, targetPrice, currency, priceHistory }: { dashboard: ValuationDashboard; result: IntrinsicResult; targetPrice: number | null; currency: string; priceHistory: { date: string; close: number }[] }) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const price = dashboard.price.comparable;
  const all: ChartRow[] = [];
  for (const k of CEILING_KEYS) {
    const c = dashboard[k].ceiling;
    if (c.status === "ESTABLISHED" && c.value !== null) all.push({ key: k, label: t.cards[k], offset: 0, span: c.value, low: c.value, high: c.value });
  }
  if (result.status === "ESTABLISHED" && result.low !== null && result.high !== null) {
    // Range bar: invisible offset up to the low end, coloured span to the high end.
    all.push({ key: "intrinsic", label: t.cards.intrinsic, offset: result.low, span: Math.max(result.high - result.low, result.high * 0.004), low: result.low, high: result.high });
  }
  const rows = all.filter((r) => !hidden.has(r.key));
  const money = (v: number | null) => formatCurrency(locale, v, currency);
  const historicalLabel = dashboard.price.basis === "HISTORICAL" ? t.chart.historicalPrice : t.chart.price;
  const toggle = (k: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.chart.title}</CardTitle>
        <CardDescription>{t.chart.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {all.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1">
              <input type="checkbox" checked={!hidden.has(r.key)} onChange={() => toggle(r.key)} className="accent-primary" />
              <span className="inline-block size-2.5 rounded-full" style={{ background: COLORS[r.key] }} />
              {r.label}
            </label>
          ))}
        </div>
        {rows.length > 0 ? (
          <div dir="ltr" className="w-full" style={{ height: 60 + rows.length * 46 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 20, right: 24, left: 8, bottom: 4 }} barCategoryGap={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" domain={[0, "auto"]} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickFormatter={(v: number) => v.toFixed(0)} stroke="var(--color-border)" />
                <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 11, fill: "var(--color-foreground)" }} stroke="var(--color-border)" />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                  content={({ active, payload }) => {
                    const r = active && payload?.[0] ? (payload[0].payload as ChartRow) : null;
                    if (!r) return null;
                    const change = price ? ((r.key === "intrinsic" ? (result.value ?? r.high) : r.high) - price) / price : null;
                    return (
                      <div className="rounded-md border bg-popover p-2 text-xs shadow">
                        <div className="font-medium">{r.label}</div>
                        <div className="font-mono">{r.low === r.high ? money(r.high) : `${money(r.low)} – ${money(r.high)}`}</div>
                        {change !== null && (
                          <div className="text-muted-foreground">
                            {t.changeRequired}: <span className="font-mono">{(change > 0 ? "+" : "") + formatPercent(locale, change)}</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="offset" stackId="v" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="span" stackId="v" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.key} fill={COLORS[r.key]} fillOpacity={r.key === "intrinsic" ? 0.85 : 0.55} />
                  ))}
                </Bar>
                {price !== null && (
                  <ReferenceLine x={price} stroke="var(--color-foreground)" strokeWidth={2} ifOverflow="extendDomain" label={{ value: `${historicalLabel} ${price.toFixed(2)}`, position: "top", fontSize: 11, fill: "var(--color-foreground)" }} />
                )}
                {targetPrice !== null && !hidden.has("intrinsic") && (
                  <ReferenceLine x={targetPrice} stroke="var(--color-positive)" strokeDasharray="5 4" ifOverflow="extendDomain" label={{ value: t.chart.mosTarget, position: "insideBottomRight", fontSize: 10, fill: "var(--color-positive)" }} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.status.NOT_ESTABLISHED}</p>
        )}
        {priceHistory.length > 1 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="text-sm font-medium">{t.chart.history}</div>
            <PriceChart
              data={priceHistory}
              currency={currency}
              drawOverlays
              overlays={[
                ...rows.filter((r) => r.key !== "intrinsic").map((r) => ({ label: r.label, value: r.high, color: COLORS[r.key] })),
                ...(result.status === "ESTABLISHED" && result.value !== null && !hidden.has("intrinsic") ? [{ label: `${t.cards.intrinsic} (${t.intrinsic.base})`, value: result.value, color: COLORS.intrinsic }] : []),
              ]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────── intrinsic value panel ───────────────────────────────

type PctKey = "revenueGrowth" | "profitMargin" | "discountRate" | "terminalGrowth" | "shareDilution";

function IntrinsicPanel({
  defaults,
  assumptions,
  setAssumptions,
  result,
  currency,
  price,
  target,
}: {
  defaults: AssumptionDefaults;
  assumptions: IntrinsicAssumptions;
  setAssumptions: (a: IntrinsicAssumptions) => void;
  result: IntrinsicResult;
  currency: string;
  price: number | null;
  target: number;
}) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard.intrinsic;
  const money = (v: number | null) => formatCurrency(locale, v, currency);
  const set = <K extends keyof IntrinsicAssumptions>(k: K, v: IntrinsicAssumptions[K]) => setAssumptions({ ...assumptions, [k]: v });
  const dcf = assumptions.method === "DCF";
  const sourceOf = (k: keyof AssumptionDefaults["sources"]) => (assumptions[k] === defaults.assumptions[k] ? t.sources[defaults.sources[k]] : t.sources.USER);
  const h = defaults.historical;

  const pctSlider = (k: PctKey, step: number, disabled = false) => {
    const [lo, hi] = INTRINSIC_LIMITS[k];
    return (
      <label key={k} className={cn("flex flex-col gap-1 text-xs", disabled && "opacity-40")}>
        <span className="flex items-center justify-between gap-2">
          <span>{t[k]}</span>
          <Num className="font-semibold">{formatPercent(locale, assumptions[k])}</Num>
        </span>
        <input type="range" dir="ltr" disabled={disabled} min={lo * 100} max={hi * 100} step={step} value={+(assumptions[k] * 100).toFixed(2)} onChange={(e) => set(k, Number(e.target.value) / 100)} className="accent-primary" aria-label={t[k]} />
        <span className="text-[10px] text-muted-foreground">{sourceOf(k)}</span>
      </label>
    );
  };

  return (
    <Card className="border-info/30">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t.title}
          <Badge variant="info" className="font-normal">
            {t.badge}
          </Badge>
        </CardTitle>
        <CardDescription>{t.note}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={assumptions.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-4 accent-primary" />
            {t.enable}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t.method}</span>
            <NativeSelect value={assumptions.method} onChange={(e) => set("method", e.target.value as IntrinsicMethod)} disabled={!assumptions.enabled}>
              <option value="DCF">{t.methods.DCF}</option>
              <option value="NORMALIZED_EARNINGS">{t.methods.NORMALIZED_EARNINGS}</option>
            </NativeSelect>
          </label>
          <Button variant="outline" size="sm" onClick={() => setAssumptions({ ...defaults.assumptions, enabled: assumptions.enabled })}>
            <RotateCcw /> {t.reset}
          </Button>
        </div>

        {assumptions.enabled && (
          <>
            <div>
              <div className="mb-2 text-sm font-medium">{t.assumptions}</div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pctSlider("revenueGrowth", 0.5, !dcf)}
                <div className="flex flex-col gap-1">
                  {pctSlider("profitMargin", 0.5, !dcf)}
                  {defaults.marginBasis && <span className="text-[10px] text-muted-foreground">{t.marginBasis[defaults.marginBasis]}</span>}
                </div>
                {pctSlider("discountRate", 0.5)}
                {pctSlider("terminalGrowth", 0.25)}
                {pctSlider("shareDilution", 0.25)}
                <label className="flex flex-col gap-1 text-xs">
                  <span className="flex items-center justify-between">
                    <span>{t.normalizationYears}</span>
                    <Num className="font-semibold">{String(assumptions.normalizationYears)}</Num>
                  </span>
                  <input type="range" dir="ltr" min={INTRINSIC_LIMITS.normalizationYears[0]} max={INTRINSIC_LIMITS.normalizationYears[1]} step={1} value={assumptions.normalizationYears} onChange={(e) => set("normalizationYears", Number(e.target.value))} className="accent-primary" aria-label={t.normalizationYears} />
                  <span className="text-[10px] text-muted-foreground">{sourceOf("normalizationYears")}</span>
                </label>
                <label className={cn("flex flex-col gap-1 text-xs", !dcf && "opacity-40")}>
                  <span className="flex items-center justify-between">
                    <span>{t.projectionYears}</span>
                    <Num className="font-semibold">{String(assumptions.projectionYears)}</Num>
                  </span>
                  <input type="range" dir="ltr" disabled={!dcf} min={INTRINSIC_LIMITS.projectionYears[0]} max={INTRINSIC_LIMITS.projectionYears[1]} step={1} value={assumptions.projectionYears} onChange={(e) => set("projectionYears", Number(e.target.value))} className="accent-primary" aria-label={t.projectionYears} />
                  <span className="text-[10px] text-muted-foreground">{sourceOf("projectionYears")}</span>
                </label>
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-xs">
              <div className="mb-1 font-medium">{fmt(t.historical, { years: h.years.length ? `FY${h.years[0]}–FY${h.years[h.years.length - 1]}` : "—" })}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-5">
                {(
                  [
                    [t.revenueCagr, formatPercent(locale, h.revenueCagr)],
                    [t.netMargin, formatPercent(locale, h.netMargin)],
                    [t.fcfMargin, formatPercent(locale, h.fcfMargin)],
                    [t.shareCagr, formatPercent(locale, h.shareCagr)],
                    [t.normalizedEps, money(h.normalizedEps)],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="flex flex-col">
                    <span className="text-muted-foreground">{label}</span>
                    <Num>{v}</Num>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {result.status === "ESTABLISHED" ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <div className="text-xs text-muted-foreground">{t.range}</div>
                <Num className="text-xl font-semibold">{`${money(result.low)} – ${money(result.high)}`}</Num>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t.base}</div>
                <Num className="text-xl font-semibold">{money(result.value)}</Num>
              </div>
              {result.terminalShare !== null && (
                <div>
                  <div className="text-xs text-muted-foreground">{t.terminalShare}</div>
                  <Num className={cn("text-xl font-semibold", result.terminalHeavy && "text-warning")}>{formatPercent(locale, result.terminalShare)}</Num>
                </div>
              )}
            </div>
            {result.sensitivity && <SensitivityGrid result={result} currency={currency} price={price} target={target} />}
            {result.projection.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-sm font-medium">{t.projection}</summary>
                <div className="mt-2 overflow-x-auto" dir="ltr">
                  <table className="w-full text-end font-mono">
                    <thead className="text-muted-foreground">
                      <tr>
                        {[t.year, t.revenue, t.earnings, t.shares, t.perShare, t.presentValue].map((x) => (
                          <th key={x} className="px-2 py-1 font-normal">
                            {x}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.projection.map((r) => (
                        <tr key={r.year} className="border-t">
                          <td className="px-2 py-1">{r.year}</td>
                          <td className="px-2 py-1">{(r.revenue / 1e6).toFixed(0)}M</td>
                          <td className="px-2 py-1">{(r.earnings / 1e6).toFixed(0)}M</td>
                          <td className="px-2 py-1">{(r.shares / 1e6).toFixed(1)}M</td>
                          <td className="px-2 py-1">{r.perShare.toFixed(2)}</td>
                          <td className="px-2 py-1">{r.presentValue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        ) : (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>{dict.valuationDashboard.status[result.status]}</AlertTitle>
            <AlertDescription>{t.reasons[result.reason]}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function SensitivityGrid({ result, currency, price, target }: { result: IntrinsicResult; currency: string; price: number | null; target: number }) {
  const { dict, locale } = useI18n();
  const t = dict.valuationDashboard.intrinsic;
  const s = result.sensitivity!;
  const colLabel = s.colKey === "revenueGrowth" ? t.revenueGrowth : t.terminalGrowth;
  const tone = (v: number | null) => {
    if (v === null || price === null) return "";
    if (price <= v * (1 - target)) return "bg-positive/15";
    if (price <= v) return "bg-warning/15";
    return "bg-negative/10";
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">{t.sensitivity}</div>
      <p className="text-xs text-muted-foreground">{fmt(t.sensitivityNote, { col: colLabel })}</p>
      <div className="overflow-x-auto" dir="ltr">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1 text-start font-normal text-muted-foreground">
                {t.discountRate} \ {colLabel}
              </th>
              {s.cols.map((c) => (
                <th key={c} className="px-2 py-1 font-mono font-normal text-muted-foreground">
                  {formatPercent(locale, c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={r}>
                <th className="px-2 py-1 text-start font-mono font-normal text-muted-foreground">{formatPercent(locale, r)}</th>
                {s.values[i].map((v, j) => {
                  const base = i === s.baseRow && j === s.baseCol;
                  const band = Math.abs(i - s.baseRow) <= 1 && Math.abs(j - s.baseCol) <= 1;
                  return (
                    <td key={j} className={cn("px-2 py-1 text-end font-mono", tone(v), band && "outline outline-1 -outline-offset-1 outline-info/40", base && "font-bold outline-2 outline-info")}>
                      {v === null ? "—" : formatCurrency(locale, v, currency)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
