import { BookOpen } from "lucide-react";
import { formatMetric } from "@/lib/format";
import { fmt, lookup, type Dictionary } from "@/lib/i18n";
import type { RuleResult, ScreenResult } from "@/lib/graham/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MethodologyBadge, StatusBadge } from "./badges";
import { MEASURE_FORMAT, USD_MEASURES } from "./metric-formats";
import { Num } from "./num";

function MeasuredValues({ rule, dict, locale, currency }: { rule: RuleResult; dict: Dictionary; locale: string; currency: string }) {
  const entries = Object.entries(rule.measured).filter(([k]) => MEASURE_FORMAT[k] !== "hidden");
  if (!entries.length) return null;
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
      {entries.map(([k, v]) => {
        const f = MEASURE_FORMAT[k] ?? "number";
        const text = f === "year" ? (v === null ? "—" : String(v)) : formatMetric(locale, v, f as never, USD_MEASURES.has(k) ? "USD" : currency);
        return (
          <div key={k} className="flex min-w-0 flex-col">
            <dt className="truncate text-muted-foreground">{lookup(dict.metrics as Record<string, string>, k)}</dt>
            <dd>
              <Num>{text}</Num>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function RuleRow({ rule, dict, locale, currency }: { rule: RuleResult; dict: Dictionary; locale: string; currency: string }) {
  const meta = (dict.rules as Record<string, { title: string; description: string }>)[rule.id] ?? { title: rule.id, description: "" };
  return (
    <li
      className={cn(
        "relative rounded-lg border bg-card/50 p-3 ps-4",
        "before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full",
        rule.status === "PASS" && "before:bg-positive",
        rule.status === "FAIL" && "before:bg-negative",
        rule.status === "INSUFFICIENT_DATA" && "before:bg-warning",
        rule.status === "NOT_APPLICABLE" && "before:bg-muted-foreground/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{meta.title}</div>
          <div className="text-xs text-muted-foreground">{meta.description}</div>
        </div>
        <span className="shrink-0">
          <StatusBadge status={rule.status} dict={dict} />
        </span>
      </div>
      <div className="mt-1.5 text-xs">{lookup(dict.reasons as Record<string, string>, rule.reason)}</div>
      <MeasuredValues rule={rule} dict={dict} locale={locale} currency={currency} />
      {(rule.assumptions?.length || rule.citation) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="font-normal">
            <BookOpen /> {fmt(dict.common.chapter, { n: rule.citation.chapter })}
          </Badge>
          {rule.assumptions?.map((a) => (
            <span key={a} className="rounded bg-muted px-1.5 py-0.5">
              {lookup(dict.assumptions as Record<string, string>, a)}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export function ScreenSummary({ screen, dict }: { screen: ScreenResult; dict: Dictionary }) {
  const total = screen.rules.length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={screen.outcome === "MEETS_ALL" ? "positive" : screen.outcome === "FAILS_ONE_OR_MORE" ? "negative" : "warning"}>
        {dict.common.outcome[screen.outcome]}
      </Badge>
      <span className="text-xs text-muted-foreground">{fmt(dict.stock.criteriaPassed, { passed: screen.passed, total })}</span>
      <MethodologyBadge methodology="GRAHAM_1973" dict={dict} />
    </div>
  );
}

/** Compact pass/fail strip: one segment per rule. */
export function ScreenStrip({ screen, dict }: { screen: ScreenResult; dict: Dictionary }) {
  return (
    <div className="flex items-center gap-1" aria-label={dict.common.outcome[screen.outcome]}>
      {screen.rules.map((r) => (
        <span
          key={r.id}
          title={`${(dict.rules as Record<string, { title: string }>)[r.id]?.title ?? r.id}: ${dict.common.status[r.status]}`}
          className={cn(
            "h-2 w-4 rounded-sm",
            r.status === "PASS" && "bg-positive",
            r.status === "FAIL" && "bg-negative",
            r.status === "INSUFFICIENT_DATA" && "bg-warning/70",
            r.status === "NOT_APPLICABLE" && "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

export function RuleList({ screen, dict, locale, currency }: { screen: ScreenResult; dict: Dictionary; locale: string; currency: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {screen.rules.map((r) => (
        <RuleRow key={r.id} rule={r} dict={dict} locale={locale} currency={currency} />
      ))}
    </ul>
  );
}
