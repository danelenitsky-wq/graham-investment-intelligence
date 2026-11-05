import type { AnnualFinancials } from "@/lib/normalization/statements";
import type { IndustryClassification } from "./classification";

export type RuleStatus = "PASS" | "FAIL" | "INSUFFICIENT_DATA" | "NOT_APPLICABLE";

/** Where a rule comes from (see src/lib/graham/registry.ts). */
export type RuleCategory = "ORIGINAL_GRAHAM" | "MATHEMATICAL_DERIVATION" | "MODERN_ADAPTATION" | "APPLICATION_INTERPRETATION";

/**
 * How far the wording of a rule has been checked.
 *  - VERIFIED_SECONDARY: matches independent reproductions of the 1973 text
 *    (no primary copy of the book is available to this code base, so nothing
 *    is marked as verified against the primary text).
 *  - UNVERIFIED: the definition could not be confirmed; it is implemented as
 *    specified by the user and flagged everywhere it is shown.
 *  - NOT_A_GRAHAM_RULE: derivations, modern adaptations and this application's
 *    own interpretations, which have no Graham wording to verify.
 */
export type VerificationLevel = "VERIFIED_SECONDARY" | "UNVERIFIED" | "NOT_A_GRAHAM_RULE";

export interface Citation {
  /** The Intelligent Investor, fourth revised edition (1973). */
  source: "INTELLIGENT_INVESTOR_1973";
  chapter: number;
  /** Section heading in the chapter (English, as printed). */
  section: string;
}

export type ValueUnit = "currency" | "currencyUsd" | "perShare" | "ratio" | "multiple" | "percent" | "count" | "year" | "shares" | "index";

/** One input the rule read, with the fiscal year it came from. */
export interface InputValue {
  key: string;
  value: number | null;
  unit: ValueUnit;
  fiscalYear?: number | null;
  /**
   * How the value was obtained when it is not a plain reported figure:
   *  - inferredAbsent: the line is not presented on an otherwise complete balance sheet (shown, never silent)
   *  - derived: computed from other reported lines (formula in the registry)
   *  - lowerBound: a bound used to prove a FAIL when the exact value is unknown
   *  - missing: not reported (the value is null; never replaced with zero)
   */
  note?: "inferredAbsent" | "derived" | "lowerBound" | "missing";
}

export type CheckOp = ">=" | "<=" | "<" | ">";

/** One numeric comparison inside a rule. `passed` is null when it cannot be decided. */
export interface RuleCheck {
  key: string;
  actual: number | null;
  op: CheckOp;
  threshold: number | null;
  unit: ValueUnit;
  passed: boolean | null;
}

export interface SourceRef {
  kind: "FILING" | "PRICE" | "DIVIDENDS" | "REFERENCE";
  label: string;
  /** Reporting period or as-of date, e.g. "FY2024 (2024-06-30)". */
  period: string | null;
  url: string | null;
}

export type ScreenKind = "DEFENSIVE" | "ENTERPRISING" | "NET_NET";

export interface RuleResult {
  /** Stable identifier, e.g. "D2", "E7", "NN1"; also the i18n key. */
  id: string;
  screen: ScreenKind;
  status: RuleStatus;
  /** Counts toward the screen's overall qualification (advisory rows do not). */
  counted: boolean;
  category: RuleCategory;
  verification: VerificationLevel;
  citation: Citation | null;
  /** Language-neutral formula, rendered left-to-right. */
  formula: string;
  inputs: InputValue[];
  checks: RuleCheck[];
  /** How checks combine: all must pass, or any one suffices. */
  combinator: "ALL" | "ANY";
  /** Explanation code (i18n key) and its parameters. */
  reason: string;
  reasonParams?: Record<string, string | number>;
  /** Registry ids of interpretations and derivations this result relies on. */
  assumptions: string[];
  sources: SourceRef[];
  /** Reporting period(s) the rule evaluated. */
  period: string | null;
}

export type ScreenOutcome = "MEETS_ALL" | "FAILS_ONE_OR_MORE" | "INCOMPLETE_DATA" | "NOT_APPLICABLE";

export interface ScreenResult {
  screen: ScreenKind;
  engineVersion: string;
  methodology: "GRAHAM_1973";
  outcome: ScreenOutcome;
  /** FULL: industrial rules; SPECIALIZED: sector-specific subset; NONE: not applicable to this issuer type. */
  ruleSet: "FULL" | "SPECIALIZED" | "NONE";
  passed: number;
  failed: number;
  insufficient: number;
  notApplicable: number;
  /** Counted rules whose original wording is UNVERIFIED. */
  unverifiedCounted: number;
  rules: RuleResult[];
}

export interface PriceInput {
  value: number;
  date: string;
  currency: string;
  sourceName?: string;
}

export interface DividendInput {
  exDate: string;
  amount: number;
}

export interface FilingProvenance {
  fiscalYear: number;
  periodEnd: string;
  sourceName: string;
  form: string | null;
  accessionNumber: string | null;
  filingUrl: string | null;
  /** concept → source XBRL tag, when known. */
  concepts?: Partial<Record<string, string>>;
}

export interface CpiReference {
  /** CPI-U annual average of the base year. */
  baseYear: number;
  baseValue: number;
  /** Comparison level (annual average or a user-entered monthly value). */
  currentLabel: string;
  currentValue: number;
  sourceLabel: string;
  sourceUrl: string | null;
}

export interface GrahamInputs {
  /** Annual financials, any order; engines sort ascending by fiscal year. */
  annual: AnnualFinancials[];
  price: PriceInput | null;
  /** Issuer type; defaults to an industrial company with unknown classification. */
  classification?: IndustryClassification;
  /** @deprecated use classification; kept for callers that only know the utility flag. */
  isUtility?: boolean;
  /** Raw cash dividends from the price provider (screened for non-cash distributions by the engine). */
  dividends?: DividendInput[];
  dividendSourceName?: string;
  /** Daily closes used to screen distributions (amount vs. price on the ex-date). */
  closes?: { date: string; close: number }[];
  /** First and last date of the provider's daily history (dividend coverage). */
  priceHistoryRange?: { first: string; last: string } | null;
  /** 1–12; statements' fiscal year end month (dividend ex-dates are attributed to fiscal years). */
  fiscalYearEndMonth?: number | null;
  /** Fiscal years in which a cash dividend was paid (used when `dividends` is not given). */
  dividendYears?: number[];
  /** Fiscal years for which dividend evidence exists (paid or not), used with `dividendYears`. */
  dividendCoverageYears?: number[];
  provenance?: FilingProvenance[];
  /** CPI reference for the modern size comparison (defaults to the sourced BLS annual averages). */
  cpi?: CpiReference | null;
  /** Multiply reporting-currency amounts by this to get USD (for size tests). */
  fxToUsd?: number | null;
  /** Enterprising earnings-growth lookback (Graham: 1966 → 1971, five years). */
  enterprisingLookbackYears?: number;
}
