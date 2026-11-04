/**
 * Investment decision engine — intentionally NOT implemented.
 *
 * Per the product scope, the platform does not issue buy/sell/hold
 * recommendations yet. This module defines the contract future work will
 * implement, so the UI and API can already reference it without inventing
 * output.
 */
import type { ScreenResult } from "@/lib/graham/types";
import type { GrahamValuation } from "@/lib/valuation/graham";
import type { FreshnessReport } from "@/lib/freshness";

export interface DecisionInputs {
  defensive: ScreenResult;
  enterprising: ScreenResult;
  valuation: GrahamValuation;
  freshness: FreshnessReport;
}

export type DecisionResult = { status: "NOT_IMPLEMENTED" };

export function evaluateDecision(_inputs: DecisionInputs): DecisionResult {
  void _inputs;
  return { status: "NOT_IMPLEMENTED" };
}
