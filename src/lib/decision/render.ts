/**
 * Turns coded statements (code + parameters from the deterministic engines)
 * into localized sentences. Only formatting happens here: every number is a
 * parameter the engines produced; nothing is calculated or invented.
 */
import { fmt, type Dictionary } from "@/lib/i18n";
import { formatCurrency, formatDate, formatNumber, MISSING } from "@/lib/format";
import type { CodedStatement, FactorAssessment } from "./types";

const CURRENCY_PARAMS = new Set(["price", "ceiling", "excessiveAbove", "level", "targetPrice", "intrinsicValue", "ncavPerShare", "threshold"]);
const PERCENT_PARAMS = new Set(["change", "percent", "weight", "maxWeight", "target", "targetPercent", "share"]);
const MULTIPLE_PARAMS = new Set(["priceToCeiling", "multiple"]);

function gateField(field: string, dict: Dictionary): string {
  if (field.startsWith("concept:")) {
    const c = field.slice("concept:".length);
    return (dict.concepts as Record<string, string>)[c] ?? c;
  }
  return (dict.health.fields as Record<string, string>)[field] ?? field;
}

const listOf = (v: string, f: (x: string) => string) => (v === MISSING || v === "—" ? MISSING : v.split(", ").map(f).join(", "));

/** Left-to-right isolate, so signs and units read correctly inside Hebrew (RTL) sentences. */
const ltr = (s: string) => `\u2066${s}\u2069`;

export function formatParam(key: string, value: string | number, dict: Dictionary, locale: string, currency: string | null): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return MISSING;
    if (CURRENCY_PARAMS.has(key)) return ltr(currency ? formatCurrency(locale, value, currency) : formatNumber(locale, value));
    if (PERCENT_PARAMS.has(key)) {
      const s = formatNumber(locale, value, 1);
      return ltr(key === "change" && value > 0 ? `+${s}%` : `${s}%`);
    }
    if (MULTIPLE_PARAMS.has(key)) return ltr(`${formatNumber(locale, value, 2)}×`);
    return ltr(formatNumber(locale, value, Number.isInteger(value) ? 0 : 2));
  }
  const d = dict.decision;
  switch (key) {
    case "strategy":
    case "thesis":
      return (d.strategies as Record<string, string>)[value] ?? value;
    case "industryClass":
      return (dict.graham.industryClass as Record<string, string>)[value] ?? value;
    case "basis":
      return value === "INTRINSIC" ? d.keyFigures.intrinsicValue : value === "CEILING" ? d.keyFigures.ceiling : value;
    case "date":
      return formatDate(locale, value);
    case "ceilingReason":
    case "reason":
      return (dict.valuationDashboard.ceilingReasons as Record<string, string>)[value] ?? value;
    case "intrinsicReason":
      return (dict.valuationDashboard.intrinsic.reasons as Record<string, string>)[value] || value;
    case "field":
      return gateField(value, dict);
    case "missing":
    case "stale":
      return listOf(value, (x) => gateField(x, dict));
    case "high":
    case "watch":
      return listOf(value, (x) => (dict.graham.risks.names as Record<string, string>)[x] ?? x);
    case "factors":
      return listOf(value, (x) => (d.factors as Record<string, string>)[x] ?? x);
    default:
      return value;
  }
}

export function formatParams(params: Record<string, string | number>, dict: Dictionary, locale: string, currency: string | null): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, formatParam(k, v, dict, locale, currency)]));
}

export function renderStatement(s: CodedStatement, dict: Dictionary, locale: string, currency: string | null): string {
  const tpl = (dict.decision.statements as Record<string, string>)[s.code] ?? s.code;
  return fmt(tpl, formatParams(s.params, dict, locale, currency));
}

export function renderFactorReason(f: FactorAssessment, dict: Dictionary, locale: string, currency: string | null): string {
  const tpl = (dict.decision.factorReasons as Record<string, string>)[f.reason] ?? f.reason;
  return fmt(tpl, formatParams(f.params, dict, locale, currency));
}

/** Compact, language-neutral evidence label: "D3:PASS", "ceiling defensive", "risk cashBurn:LOW". */
export function evidenceLabel(e: CodedStatement["evidence"][number]): string {
  const s = e.status ? `:${e.status}` : "";
  switch (e.kind) {
    case "RULE":
      return `${e.ref}${s}`;
    case "RISK":
      return `risk ${e.ref}${s}`;
    case "GATE":
      return `gate ${e.ref}${s}`;
    default:
      return `${e.kind.toLowerCase()} ${e.ref}${s}`;
  }
}
