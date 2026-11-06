/**
 * Types of the explainable investment decision-support engine.
 *
 * The categories are APPLICATION-DEFINED research classifications, not
 * trading instructions and not rules written by Benjamin Graham. Every
 * classification is produced by deterministic code from the outputs of the
 * Graham rules engine, the valuation engine and the data-quality gate, and
 * carries the evidence it was derived from.
 */
import type { GrahamAnalysis } from "@/lib/graham";
import type { FreshnessReport } from "@/lib/freshness";
import type { GateResult } from "@/lib/freshness/gate";
import type { RuleStatus } from "@/lib/graham/types";
import type { ValuationDashboard } from "@/lib/valuation/engine";
import type { IntrinsicResult } from "@/lib/valuation/intrinsic";

export type DecisionCategory = "BUY_CANDIDATE" | "HOLD" | "WAIT" | "REVIEW_FOR_SALE" | "AVOID" | "INSUFFICIENT_VERIFIED_DATA";

export const DECISION_CATEGORIES: DecisionCategory[] = ["BUY_CANDIDATE", "HOLD", "WAIT", "REVIEW_FOR_SALE", "AVOID", "INSUFFICIENT_VERIFIED_DATA"];

/** The Graham strategy the classification is made under. */
export type Strategy = "DEFENSIVE" | "ENTERPRISING" | "NET_NET";
export const STRATEGIES: Strategy[] = ["DEFENSIVE", "ENTERPRISING", "NET_NET"];

export type FactorId =
  | "defensive"
  | "enterprising"
  | "netNet"
  | "financialStrength"
  | "earningsStability"
  | "valuation"
  | "marginOfSafety"
  | "investmentRisks"
  | "ownership"
  | "dataQuality";

export const FACTOR_IDS: FactorId[] = [
  "defensive",
  "enterprising",
  "netNet",
  "financialStrength",
  "earningsStability",
  "valuation",
  "marginOfSafety",
  "investmentRisks",
  "ownership",
  "dataQuality",
];

/**
 * FAVORABLE … CRITICAL describe the factor, not the stock. UNKNOWN means the
 * data needed to judge the factor is missing; NOT_APPLICABLE that the factor
 * does not apply (e.g. a position factor for a stock that is not owned).
 */
export type FactorStatus = "FAVORABLE" | "NEUTRAL" | "UNFAVORABLE" | "CRITICAL" | "UNKNOWN" | "NOT_APPLICABLE";

/** A pointer to the deterministic result or sourced fact a statement relies on. */
export interface Evidence {
  kind: "RULE" | "CEILING" | "INTRINSIC" | "RISK" | "GATE" | "POSITION" | "PRICE" | "FRESHNESS" | "SETTING";
  /** Rule id (D3), ceiling id (defensive), risk id (cashBurn), gate field, setting key… */
  ref: string;
  status?: RuleStatus | string;
  value?: number | null;
  unit?: "perShare" | "percent" | "ratio" | "multiple" | "currency" | "count" | "days";
  period?: string | null;
}

export interface FactorAssessment {
  id: FactorId;
  status: FactorStatus;
  /** i18n reason code (decision.factorReasons.<code>). */
  reason: string;
  params: Record<string, string | number>;
  evidence: Evidence[];
  /** The factor belongs to the strategy the classification is made under. */
  inStrategy: boolean;
}

export interface CodedStatement {
  code: string;
  params: Record<string, string | number>;
  factor: FactorId | null;
  evidence: Evidence[];
}

export interface DecisionSettings {
  /** Strategy used when the user has not chosen one on the page. */
  strategy: Strategy;
  /** Largest acceptable position weight in the portfolio (0.20 = 20%). Application assumption. */
  maxPositionWeight: number;
  /**
   * Valuation is "excessive" when the price exceeds the reference value by
   * this multiple: intrinsic value when one is established, otherwise the
   * strategy's Graham price ceiling. Application assumption.
   */
  excessiveValuationMultiple: number;
  /** Require an established intrinsic-value margin of safety before BUY CANDIDATE. */
  requireIntrinsicMarginOfSafety: boolean;
}

export const DEFAULT_DECISION_SETTINGS: DecisionSettings = {
  strategy: "DEFENSIVE",
  maxPositionWeight: 0.2,
  excessiveValuationMultiple: 1.5,
  requireIntrinsicMarginOfSafety: false,
};

export interface PositionContext {
  quantity: number;
  averageCost: number;
  currency: string;
  /** Market-value weight in the portfolio (0–1); null when it cannot be valued. */
  weight: number | null;
  marketValue: number | null;
  /** Strategy recorded as the reason the position was bought; null = not recorded. */
  thesisStrategy: Strategy | null;
  openedAt: string | null;
}

export interface VerificationCounts {
  verified: number;
  conflict: number;
  singleSource: number;
  unverified: number;
}

export interface DecisionInputs {
  /** Strategy chosen for this evaluation (page selection or settings default). */
  strategy: Strategy;
  graham: GrahamAnalysis;
  dashboard: ValuationDashboard;
  intrinsic: IntrinsicResult | null;
  /** Margin-of-safety target as a fraction (0.30 = 30%). */
  marginOfSafetyTarget: number;
  gate: GateResult;
  freshness: FreshnessReport;
  /** Cross-source verification of material metrics; null when never checked. */
  verification: VerificationCounts | null;
  /** The position held in the portfolio, or null when the stock is not owned. */
  position: PositionContext | null;
  settings: DecisionSettings;
  /** Months after the fiscal period end at which statements count as stale (freshness settings). */
  fundamentalsStaleMonths?: number;
}

export type Confidence = "STANDARD" | "LOW";

export interface KeyFigures {
  currency: string | null;
  price: number | null;
  priceDate: string | null;
  priceBasis: "CURRENT" | "HISTORICAL" | "UNAVAILABLE";
  /** Strategy price ceiling (Graham screening limit; never intrinsic value). */
  ceiling: number | null;
  ceilingStrict: boolean;
  /** Price above which valuation counts as excessive (owned positions). */
  excessiveAbove: number | null;
  excessiveBasis: "INTRINSIC" | "CEILING" | null;
  intrinsicValue: number | null;
  marginOfSafetyPercent: number | null;
  marginOfSafetyTargetPrice: number | null;
  ncavPerShare: number | null;
  grahamNumber: number | null;
}

export interface DecisionResult {
  status: "EVALUATED";
  engineVersion: string;
  methodology: "APPLICATION_CLASSIFICATION";
  category: DecisionCategory;
  /** Strategy the classification was made under (the position's thesis when owned). */
  strategy: Strategy;
  selectedStrategy: Strategy;
  strategySource: "SELECTED" | "POSITION_THESIS";
  owned: boolean;
  /** STANDARD or LOW for BUY CANDIDATE / HOLD; null otherwise. */
  confidence: Confidence | null;
  /** Why the category was assigned, in evaluation order. */
  reasons: CodedStatement[];
  /** Review-for-sale triggers that fired (owned positions only). */
  reviewTriggers: CodedStatement[];
  /** Qualifications that lower confidence or need the reader's attention. */
  caveats: CodedStatement[];
  /** What would change the assessment, with the deterministic threshold. */
  conditions: CodedStatement[];
  factors: FactorAssessment[];
  keyFigures: KeyFigures;
}
