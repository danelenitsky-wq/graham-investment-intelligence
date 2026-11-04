"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatCurrency } from "@/lib/format";
import { useI18n } from "@/components/layout/providers";

const tooltipStyle = { background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };
const tick = { fontSize: 11, fill: "var(--color-muted-foreground)" };

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

/** Annual bars (e.g. revenue vs. net income). Missing years stay empty rather than zero. */
export function AnnualBarChart({ data, series, currency }: { data: Record<string, number | null>[]; series: SeriesDef[]; currency: string }) {
  const { locale } = useI18n();
  return (
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="fiscalYear" tick={tick} stroke="var(--color-border)" />
          <YAxis orientation="right" tick={tick} tickFormatter={(v: number) => formatCompact("en", v)} width={52} stroke="var(--color-border)" />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatCompact(locale, Number(v), currency), String(name)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Per-share lines (EPS, book value, dividends). */
export function PerShareLineChart({ data, series, currency }: { data: Record<string, number | null>[]; series: SeriesDef[]; currency: string }) {
  const { locale } = useI18n();
  return (
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="fiscalYear" tick={tick} stroke="var(--color-border)" />
          <YAxis orientation="right" tick={tick} width={44} stroke="var(--color-border)" />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatCurrency(locale, Number(v), currency), String(name)]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
