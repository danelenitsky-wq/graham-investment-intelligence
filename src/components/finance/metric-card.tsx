import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMetric, type MetricFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Num, signTone } from "./num";

export interface MetricCardProps {
  label: string;
  value: number | null | undefined;
  format?: MetricFormat;
  currency?: string;
  locale: string;
  /** Explanation shown when hovering the info icon (definition, source or why it is missing). */
  hint?: string;
  sub?: React.ReactNode;
  badge?: React.ReactNode;
  toneBySign?: boolean;
  className?: string;
}

/** A single KPI tile. Missing values render as "—" with the hint explaining why. */
export function MetricCard({ label, value, format = "number", currency, locale, hint, sub, badge, toneBySign, className }: MetricCardProps) {
  const text = formatMetric(locale, value, format, currency);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-4 shadow-xs", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          {badge}
          {hint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label={hint}>
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>
      <Num className="text-xl font-semibold tracking-tight" tone={toneBySign ? signTone(value) : undefined}>
        {text}
      </Num>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Compact label/value row for dense panels. */
export function MetricRow({ label, value, format = "number", currency, locale, toneBySign }: Omit<MetricCardProps, "hint" | "sub" | "badge">) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <Num tone={toneBySign ? signTone(value) : undefined}>{formatMetric(locale, value, format, currency)}</Num>
    </div>
  );
}
