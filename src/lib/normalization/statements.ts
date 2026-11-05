/**
 * Financial statement normalization: SEC XBRL companyfacts → canonical annual
 * periods. Pure functions, no I/O.
 */
import type { CompanyFacts, SecFact } from "@/lib/providers/sec-edgar/types";
import { CANONICAL_CONCEPTS, CONCEPTS, type CanonicalConcept, type ConceptUnit } from "./concepts";

export const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "10-KT", "10-KT/A", "20-F", "20-F/A", "40-F", "40-F/A"]);

/** Annual durations: 52/53-week fiscal years land between ~357 and ~371 days. */
const MIN_ANNUAL_DAYS = 350;
const MAX_ANNUAL_DAYS = 380;
/** Cover-page (dei) share counts are dated after year end; accept up to this lag. */
const DEI_COVER_LAG_DAYS = 120;

export interface NormalizedValue {
  value: number;
  sourceConcept: string;
  unit: string;
  accessionNumber: string;
  filedAt: string;
  form: string;
  /** A later filing reported a different value than the original filing. */
  restated: boolean;
  /** Value was multiplied/divided to account for stock splits after filing. */
  splitAdjusted: boolean;
}

export interface NormalizedAnnualPeriod {
  fiscalYear: number;
  /** "FY" for annual periods, "Q1".."Q4" for quarters. */
  fiscalPeriod?: string;
  periodStart: string | null;
  periodEnd: string;
  currency: string;
  values: Partial<Record<CanonicalConcept, NormalizedValue>>;
}

export interface SplitEvent {
  /** ISO date the split took effect. */
  exDate: string;
  /** New shares per old share (2-for-1 → 2). */
  ratio: number;
}

export interface NormalizationWarning {
  code:
    | "NO_ANNUAL_DATA"
    | "MULTIPLE_CURRENCIES"
    | "PER_SHARE_NOT_SPLIT_ADJUSTED"
    | "MISSING_FISCAL_YEARS"
    | "UNSUPPORTED_TAXONOMY";
  message: string;
  context?: Record<string, unknown>;
}

export interface NormalizationResult {
  entityName: string;
  currency: string | null;
  periods: NormalizedAnnualPeriod[]; // ascending by periodEnd
  warnings: NormalizationWarning[];
}

const DAY_MS = 86_400_000;
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/**
 * Fiscal year label convention: the calendar year in which the fiscal year
 * ends, except 52/53-week years that end in the first week of January, which
 * belong to the previous year (e.g. a year ending 2022-01-01 is FY2021).
 */
export function fiscalYearFromPeriodEnd(periodEnd: string): number {
  const d = new Date(periodEnd + "T00:00:00Z");
  const y = d.getUTCFullYear();
  if (d.getUTCMonth() === 0 && d.getUTCDate() <= 7) return y - 1;
  return y;
}

function quarterLabel(end: string, original: SecFact | undefined, quarterly: boolean): { fiscalYear: number; fiscalPeriod: string } {
  if (!quarterly) return { fiscalYear: fiscalYearFromPeriodEnd(end), fiscalPeriod: "FY" };
  const fp = original?.fp && /^Q[1-4]$/.test(original.fp) ? original.fp : original?.fp === "FY" ? "Q4" : "Q?";
  return { fiscalYear: original?.fy ?? fiscalYearFromPeriodEnd(end), fiscalPeriod: fp };
}

function splitTag(tag: string): [string, string] {
  const i = tag.indexOf(":");
  return [tag.slice(0, i), tag.slice(i + 1)];
}

function unitMatches(unitKey: string, unit: ConceptUnit, currency: string | null): boolean {
  const k = unitKey.toLowerCase();
  if (unit === "shares") return k === "shares";
  if (unit === "perShare") return k.endsWith("/shares") && (!currency || unitKey.startsWith(currency));
  // currency: plain ISO code
  return !k.includes("/") && k !== "shares" && k !== "pure" && (!currency || unitKey === currency);
}

/** Determine the reporting currency from the most frequently used unit on us-gaap:Assets. */
export function detectReportingCurrency(facts: CompanyFacts): { currency: string | null; all: string[] } {
  const assets = facts.facts["us-gaap"]?.["Assets"] ?? facts.facts["ifrs-full"]?.["Assets"];
  if (!assets) return { currency: null, all: [] };
  const counts = Object.entries(assets.units)
    .filter(([u]) => /^[A-Z]{3}$/.test(u))
    .map(([u, arr]) => [u, arr.length] as const)
    .sort((a, b) => b[1] - a[1]);
  return { currency: counts[0]?.[0] ?? null, all: counts.map(([u]) => u) };
}

function cumulativeSplitFactorAfter(filedAt: string, splits: SplitEvent[]): number {
  return splits.filter((s) => s.exDate > filedAt && s.ratio > 0).reduce((f, s) => f * s.ratio, 1);
}

/**
 * Pick, among facts reported for the same period (original + later
 * comparatives / amendments), the most recently filed one.
 */
function pickLatest(facts: SecFact[]): { fact: SecFact; restated: boolean } {
  const sorted = [...facts].sort((a, b) => a.filed.localeCompare(b.filed));
  const latest = sorted[sorted.length - 1];
  const original = sorted[0];
  return { fact: latest, restated: sorted.length > 1 && original.val !== latest.val };
}

export interface NormalizeOptions {
  /** Known stock splits; when omitted, per-share values are as reported. */
  splits?: SplitEvent[];
}

export const QUARTERLY_FORMS = new Set(["10-Q", "10-Q/A", ...ANNUAL_FORMS]);
const MIN_QUARTER_DAYS = 80;
const MAX_QUARTER_DAYS = 100;

interface PeriodSpec {
  forms: Set<string>;
  minDays: number;
  maxDays: number;
  quarterly: boolean;
}
const ANNUAL_SPEC: PeriodSpec = { forms: ANNUAL_FORMS, minDays: MIN_ANNUAL_DAYS, maxDays: MAX_ANNUAL_DAYS, quarterly: false };
const QUARTER_SPEC: PeriodSpec = { forms: QUARTERLY_FORMS, minDays: MIN_QUARTER_DAYS, maxDays: MAX_QUARTER_DAYS, quarterly: true };

export function normalizeCompanyFacts(facts: CompanyFacts, options: NormalizeOptions = {}): NormalizationResult {
  return normalizeWithSpec(facts, options, ANNUAL_SPEC);
}

/**
 * Discrete three-month quarters as reported in 10-Q (and, when an issuer
 * reports them, 10-K) filings. Fourth quarters are only present when the
 * issuer reported a three-month Q4 figure; they are never derived as FY − 9M.
 */
export function normalizeQuarterlyFacts(facts: CompanyFacts, options: NormalizeOptions = {}): NormalizationResult {
  return normalizeWithSpec(facts, options, QUARTER_SPEC);
}

function normalizeWithSpec(facts: CompanyFacts, options: NormalizeOptions, spec: PeriodSpec): NormalizationResult {
  const warnings: NormalizationWarning[] = [];
  const { currency, all } = detectReportingCurrency(facts);

  if (!facts.facts["us-gaap"]) {
    warnings.push({
      code: "UNSUPPORTED_TAXONOMY",
      message: "Issuer does not report in the US GAAP taxonomy (IFRS filers are not supported yet).",
      context: { taxonomies: Object.keys(facts.facts) },
    });
    return { entityName: facts.entityName, currency, periods: [], warnings };
  }
  if (all.length > 1) {
    warnings.push({
      code: "MULTIPLE_CURRENCIES",
      message: `Facts reported in several currencies (${all.join(", ")}); using ${currency}.`,
    });
  }

  // 1) Collect annual duration periods (keyed by end date) from flow concepts.
  const periodStarts = new Map<string, string>();
  // Earliest-filed fact per period end: its fy/fp describe that period (later comparatives carry the later filing's fy/fp).
  const originalFact = new Map<string, SecFact>();
  for (const concept of CANONICAL_CONCEPTS) {
    const def = CONCEPTS[concept];
    if (def.instant) continue;
    for (const tag of def.candidates) {
      const [tax, name] = splitTag(tag);
      const units = facts.facts[tax]?.[name]?.units ?? {};
      for (const [unitKey, arr] of Object.entries(units)) {
        if (!unitMatches(unitKey, def.unit, currency)) continue;
        for (const f of arr) {
          if (!spec.forms.has(f.form) || !f.start) continue;
          const days = daysBetween(f.start, f.end);
          if (days < spec.minDays || days > spec.maxDays) continue;
          if (!periodStarts.has(f.end)) periodStarts.set(f.end, f.start);
          const o = originalFact.get(f.end);
          if (!o || f.filed < o.filed) originalFact.set(f.end, f);
        }
      }
    }
  }

  if (periodStarts.size === 0) {
    if (!spec.quarterly) warnings.push({ code: "NO_ANNUAL_DATA", message: "No annual (10-K / 20-F) financial facts found." });
    return { entityName: facts.entityName, currency, periods: [], warnings };
  }

  const splits = options.splits ?? [];
  const periods: NormalizedAnnualPeriod[] = [...periodStarts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([end, start]) => ({
      ...quarterLabel(end, originalFact.get(end), spec.quarterly),
      periodStart: start,
      periodEnd: end,
      currency: currency ?? "USD",
      values: {},
    }));

  // 2) Fill each period with the first candidate tag that has a value for it.
  for (const period of periods) {
    for (const concept of CANONICAL_CONCEPTS) {
      const def = CONCEPTS[concept];
      for (const tag of def.candidates) {
        const [tax, name] = splitTag(tag);
        const units = facts.facts[tax]?.[name]?.units ?? {};
        const matches: { fact: SecFact; unitKey: string }[] = [];
        for (const [unitKey, arr] of Object.entries(units)) {
          if (!unitMatches(unitKey, def.unit, currency)) continue;
          for (const f of arr) {
            if (!spec.forms.has(f.form)) continue;
            if (def.instant) {
              if (f.start) continue;
              if (tax === "dei") {
                const lag = daysBetween(period.periodEnd, f.end);
                if (lag < 0 || lag > DEI_COVER_LAG_DAYS) continue;
              } else if (f.end !== period.periodEnd) continue;
            } else {
              if (!f.start || f.end !== period.periodEnd) continue;
              const days = daysBetween(f.start, f.end);
              if (days < spec.minDays || days > spec.maxDays) continue;
            }
            matches.push({ fact: f, unitKey });
          }
        }
        if (matches.length === 0) continue;

        const { fact, restated } = pickLatest(matches.map((m) => m.fact));
        const unitKey = matches.find((m) => m.fact === fact)!.unitKey;
        let value = fact.val;
        let splitAdjusted = false;
        if (def.unit === "perShare" || def.unit === "shares") {
          const factor = cumulativeSplitFactorAfter(fact.filed, splits);
          if (factor !== 1) {
            value = def.unit === "perShare" ? value / factor : value * factor;
            splitAdjusted = true;
          }
        }
        period.values[concept] = {
          value,
          sourceConcept: tag,
          unit: unitKey,
          accessionNumber: fact.accn,
          filedAt: fact.filed,
          form: fact.form,
          restated,
          splitAdjusted,
        };
        break;
      }
    }
  }

  if (spec.quarterly) return { entityName: facts.entityName, currency, periods, warnings: [] };

  // 3) Warnings about history quality.
  const years = periods.map((p) => p.fiscalYear);
  const missing: number[] = [];
  for (let y = years[0]; y <= years[years.length - 1]; y++) if (!years.includes(y)) missing.push(y);
  if (missing.length) {
    warnings.push({
      code: "MISSING_FISCAL_YEARS",
      message: `No annual data for fiscal years: ${missing.join(", ")}.`,
      context: { missing },
    });
  }
  if (!options.splits) {
    warnings.push({
      code: "PER_SHARE_NOT_SPLIT_ADJUSTED",
      message:
        "Stock split history unavailable: per-share values from older filings are as originally reported and may not be comparable.",
    });
  }

  return { entityName: facts.entityName, currency, periods, warnings };
}

/** Flatten normalized periods into the plain numeric shape the engines consume. */
export function toAnnualFinancials(periods: NormalizedAnnualPeriod[]): AnnualFinancials[] {
  return periods.map((p) => ({
    fiscalYear: p.fiscalYear,
    periodEnd: p.periodEnd,
    currency: p.currency,
    values: Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, v!.value])) as Partial<
      Record<CanonicalConcept, number>
    >,
  }));
}

/** Engine-facing annual record: plain numbers, missing values are absent (never zero-filled). */
export interface AnnualFinancials {
  fiscalYear: number;
  periodEnd: string;
  currency: string;
  values: Partial<Record<CanonicalConcept, number>>;
}
