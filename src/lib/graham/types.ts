import type { AnnualFinancials } from "@/lib/normalization/statements";

export type RuleStatus = "PASS" | "FAIL" | "INSUFFICIENT_DATA" | "NOT_APPLICABLE";

export interface Citation {
  /** The Intelligent Investor, fourth revised edition (1973). */
  source: "INTELLIGENT_INVESTOR_1973";
  chapter: number;
  note?: string;
}

export interface RuleResult {
  /** Stable identifier; also the i18n key for title/description. */
  id: string;
  status: RuleStatus;
  /** Numbers the rule measured (null when not computable). */
  measured: Record<string, number | null>;
  /** Thresholds the rule compared against. */
  thresholds: Record<string, number>;
  /** Machine-readable explanation code (i18n key) for the status. */
  reason: string;
  /** Interpretation choices this implementation made, shown to the user. */
  assumptions?: string[];
  citation: Citation;
}

export type ScreenOutcome = "MEETS_ALL" | "FAILS_ONE_OR_MORE" | "INCOMPLETE_DATA";

export interface ScreenResult {
  screen: "DEFENSIVE" | "ENTERPRISING";
  engineVersion: string;
  methodology: "GRAHAM_1973";
  outcome: ScreenOutcome;
  passed: number;
  failed: number;
  insufficient: number;
  rules: RuleResult[];
}

export interface PriceInput {
  value: number;
  date: string;
  currency: string;
}

export interface GrahamInputs {
  /** Annual financials, any order; engines sort ascending by fiscal year. */
  annual: AnnualFinancials[];
  price: PriceInput | null;
  isUtility: boolean;
  /** Years (fiscal) in which a cash dividend was paid, from any provider. */
  dividendYears?: number[];
  /** Years for which we have evidence about dividends (paid or not). */
  dividendCoverageYears?: number[];
  /** Multiply reporting-currency amounts by this to get USD (for size tests). */
  fxToUsd?: number | null;
}
