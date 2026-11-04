"use client";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { useI18n } from "@/components/layout/providers";
import { cn } from "@/lib/utils";

type Range = "1Y" | "5Y" | "10Y" | "MAX";
const YEARS: Record<Range, number | null> = { "1Y": 1, "5Y": 5, "10Y": 10, MAX: null };

/** Interactive closing-price chart. Charts always run left→right (time axis), even in RTL. */
export function PriceChart({ data, currency, overlays = [] }: { data: { date: string; close: number }[]; currency: string; overlays?: { label: string; value: number }[] }) {
  const { locale, dict } = useI18n();
  const [range, setRange] = useState<Range>("5Y");
  const filtered = useMemo(() => {
    const years = YEARS[range];
    if (!years || data.length === 0) return data;
    const last = Date.parse(data[data.length - 1].date);
    const cutoff = last - years * 365.25 * 86_400_000;
    return data.filter((d) => Date.parse(d.date) >= cutoff);
  }, [data, range]);
  const first = filtered[0]?.close;
  const last = filtered[filtered.length - 1]?.close;
  const change = first && last ? last / first - 1 : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(Object.keys(YEARS) as Range[]).map((r) => (
            <Button key={r} size="sm" variant={r === range ? "secondary" : "ghost"} onClick={() => setRange(r)} className="h-7 px-2.5 text-xs">
              {dict.stock.ranges[r]}
            </Button>
          ))}
        </div>
        {change !== null && (
          <bdi dir="ltr" className={cn("num font-mono text-sm", change >= 0 ? "text-positive" : "text-negative")}>
            {change >= 0 ? "+" : ""}
            {(change * 100).toFixed(1)}%
          </bdi>
        )}
      </div>
      <div dir="ltr" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filtered} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(locale, d, { year: "2-digit", month: "short" })}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              minTickGap={40}
              stroke="var(--color-border)"
            />
            <YAxis
              orientation="right"
              domain={["auto", "auto"]}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickFormatter={(v: number) => v.toFixed(0)}
              width={48}
              stroke="var(--color-border)"
            />
            <Tooltip
              contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(d) => formatDate(locale, String(d))}
              formatter={(v) => [formatCurrency(locale, Number(v), currency), dict.common.close]}
            />
            <Area type="monotone" dataKey="close" stroke="var(--color-chart-1)" strokeWidth={1.6} fill="url(#priceFill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {overlays.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {overlays.map((o) => (
            <span key={o.label}>
              {o.label}: <bdi dir="ltr" className="num font-mono text-foreground">{formatCurrency(locale, o.value, currency)}</bdi>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
