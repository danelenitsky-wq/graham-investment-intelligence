import { BookOpen, ExternalLink, ShieldAlert } from "lucide-react";
import { formatCompact, formatMetric, MISSING } from "@/lib/format";
import { fmt, lookup, type Dictionary } from "@/lib/i18n";
import type { InputValue, RuleCheck, RuleResult, ScreenResult, ValueUnit } from "@/lib/graham/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./badges";
import { Num } from "./num";

type G = Dictionary["graham"];

/** Format an engine value by its unit. Missing stays "—", never 0. */
export function formatValue(locale: string, v: number | null, unit: ValueUnit, currency: string): string {
  if (v === null || !Number.isFinite(v)) return MISSING;
  switch (unit) {
    case "currency":
      return formatMetric(locale, v, "compactCurrency", currency);
    case "currencyUsd":
      return formatMetric(locale, v, "compactCurrency", "USD");
    case "perShare":
      return formatMetric(locale, v, "currency", currency);
    case "ratio":
      return formatMetric(locale, v, "ratio");
    case "multiple":
      return formatMetric(locale, v, "multiple");
    case "percent":
      return formatMetric(locale, v, "percent");
    case "count":
      return formatMetric(locale, v, "integer");
    case "year":
      return String(v);
    case "shares":
      return formatCompact(locale, v);
    default:
      return formatMetric(locale, v, "number");
  }
}

export function ruleName(g: G, id: string) {
  return (g.rules as Record<string, { name: string; description: string }>)[id] ?? { name: id, description: "" };
}

export function reasonText(g: G, reason: string, params: Record<string, string | number> | undefined) {
  const p = { ...(params ?? {}) };
  if (typeof p.industryClass === "string") p.industryClass = lookup(g.industryClass as Record<string, string>, p.industryClass);
  return fmt(lookup(g.reasons as Record<string, string>, reason), p);
}

const valueLabel = (g: G, key: string) => lookup(g.values as Record<string, string>, key);

function CheckLine({ c, g, locale, currency }: { c: RuleCheck; g: G; locale: string; currency: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className="text-muted-foreground">{valueLabel(g, c.key)}:</span>
      <Num>{formatValue(locale, c.actual, c.unit, currency)}</Num>
      <bdi dir="ltr" className="font-mono text-muted-foreground">
        {c.op}
      </bdi>
      <Num>{formatValue(locale, c.threshold, c.unit, currency)}</Num>
      <span className={cn("rounded px-1.5 py-0.5 text-[11px]", c.passed === true && "bg-positive/12 text-positive", c.passed === false && "bg-negative/12 text-negative", c.passed === null && "bg-warning/12 text-warning")}>
        {c.passed === true ? g.checkPassed : c.passed === false ? g.checkFailed : g.checkUnknown}
      </span>
    </div>
  );
}

function InputsTable({ inputs, g, locale, currency }: { inputs: InputValue[]; g: G; locale: string; currency: string }) {
  if (!inputs.length) return null;
  return (
    <table className="w-full text-xs">
      <tbody>
        {inputs.map((i, idx) => (
          <tr key={`${i.key}-${i.fiscalYear ?? ""}-${idx}`} className="border-b border-border/50 last:border-0">
            <td className="py-1 pe-2 text-muted-foreground">
              {valueLabel(g, i.key)}
              {i.fiscalYear ? (
                <span className="ms-1">
                  (<bdi dir="ltr">FY{i.fiscalYear}</bdi>)
                </span>
              ) : null}
            </td>
            <td className="py-1 pe-2 text-end">
              <Num>{formatValue(locale, i.value, i.unit, currency)}</Num>
            </td>
            <td className="py-1 text-end text-[11px] text-muted-foreground">{i.note ? lookup(g.notes as Record<string, string>, i.note) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RuleRow({ rule, dict, locale, currency }: { rule: RuleResult; dict: Dictionary; locale: string; currency: string }) {
  const g = dict.graham;
  const meta = ruleName(g, rule.id);
  const na = rule.status === "NOT_APPLICABLE";
  return (
    <li
      className={cn(
        "relative rounded-lg border bg-card/50 p-3 ps-4",
        "before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full",
        rule.status === "PASS" && "before:bg-positive",
        rule.status === "FAIL" && "before:bg-negative",
        rule.status === "INSUFFICIENT_DATA" && "before:bg-warning",
        na && "before:bg-muted-foreground/40",
        !rule.counted && "border-dashed",
      )}
      data-rule-id={rule.id}
      data-rule-status={rule.status}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{meta.name}</div>
          <div className="text-xs text-muted-foreground">{meta.description}</div>
        </div>
        <span className="shrink-0">
          <StatusBadge status={rule.status} dict={dict} />
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
        <Badge variant={rule.category === "MODERN_ADAPTATION" ? "info" : "outline"} className="font-normal">
          {g.category[rule.category]}
        </Badge>
        {rule.verification === "UNVERIFIED" && (
          <Badge variant="warning" className="font-semibold">
            <ShieldAlert /> {g.verification.UNVERIFIED}
          </Badge>
        )}
        {!rule.counted && (
          <Badge variant="muted" className="font-normal">
            {g.advisory}
          </Badge>
        )}
      </div>
      <div className="mt-1.5 text-xs">{reasonText(g, rule.reason, rule.reasonParams)}</div>
      {rule.checks.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {rule.checks.map((c) => (
            <CheckLine key={c.key} c={c} g={g} locale={locale} currency={currency} />
          ))}
        </div>
      )}
      {!na && (
        <details className="group mt-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer select-none font-medium text-muted-foreground">{g.formulaDetails}</summary>
          <div className="mt-2 flex flex-col gap-3">
            <section>
              <h4 className="mb-1 font-medium">{g.formula}</h4>
              <code dir="ltr" className="block rounded bg-background px-2 py-1 text-start font-mono text-[11px]">
                {rule.formula}
              </code>
              {rule.checks.length > 1 && <p className="mt-1 text-muted-foreground">{rule.combinator === "ANY" ? g.combinatorAny : g.combinatorAll}</p>}
            </section>
            <section>
              <h4 className="mb-1 font-medium">{g.inputs}</h4>
              <InputsTable inputs={rule.inputs} g={g} locale={locale} currency={currency} />
            </section>
            {rule.period && (
              <section>
                <h4 className="mb-1 font-medium">{g.period}</h4>
                <bdi dir="ltr">{rule.period}</bdi>
              </section>
            )}
            {rule.citation && (
              <section>
                <h4 className="mb-1 font-medium">{g.reference}</h4>
                <span className="inline-flex items-center gap-1">
                  <BookOpen className="size-3.5" />
                  {fmt(g.chapterSection, { chapter: rule.citation.chapter, section: rule.citation.section })}
                </span>
                <span className="ms-2 text-muted-foreground">· {g.verification[rule.verification]}</span>
              </section>
            )}
            {rule.assumptions.length > 0 && (
              <section>
                <h4 className="mb-1 font-medium">{g.assumptions}</h4>
                <ul className="flex flex-col gap-0.5">
                  {rule.assumptions.map((a) => (
                    <li key={a}>
                      <bdi dir="ltr" className="me-1 rounded bg-muted px-1 font-mono text-[10px]">
                        {a}
                      </bdi>
                      {lookup(g.assumptionText as Record<string, string>, a)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4 className="mb-1 font-medium">{g.sources}</h4>
              {rule.sources.length ? (
                <ul className="flex flex-col gap-0.5">
                  {rule.sources.map((s, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                          {s.label} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span>{s.label}</span>
                      )}
                      {s.period && (
                        <bdi dir="ltr" className="text-muted-foreground">
                          {s.period}
                        </bdi>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">{g.noSources}</span>
              )}
            </section>
          </div>
        </details>
      )}
    </li>
  );
}

export function ScreenSummary({ screen, dict }: { screen: ScreenResult; dict: Dictionary }) {
  const g = dict.graham;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={screen.outcome === "MEETS_ALL" ? "positive" : screen.outcome === "FAILS_ONE_OR_MORE" ? "negative" : screen.outcome === "NOT_APPLICABLE" ? "muted" : "warning"}>
        {g.outcome[screen.outcome]}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {fmt(g.counts, { passed: screen.passed, failed: screen.failed, insufficient: screen.insufficient, na: screen.notApplicable })}
      </span>
    </div>
  );
}

/** Compact pass/fail strip: one segment per counted rule. */
export function ScreenStrip({ screen, dict }: { screen: ScreenResult; dict: Dictionary }) {
  return (
    <div className="flex items-center gap-1" aria-label={dict.graham.outcome[screen.outcome]}>
      {screen.rules
        .filter((r) => r.counted)
        .map((r) => (
          <span
            key={r.id}
            title={`${ruleName(dict.graham, r.id).name}: ${dict.common.status[r.status]}`}
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
