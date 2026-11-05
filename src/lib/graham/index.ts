/**
 * Graham analysis engine entry point: one deterministic run over normalized,
 * sourced data → Defensive (Ch. 14), Enterprising (Ch. 15) and Net-Net panels.
 * No LLM is involved in any calculation; no valuation or recommendation is made.
 */
import type { IndustryClassification } from "./classification";
import { dividendEvidence, type ExcludedDistribution } from "./dividends";
import { buildTrends, netNetFromContext, type NetNetResult, type TrendRow } from "./netnet";
import { buildContext, defensiveFromContext, enterprisingFromContext, GRAHAM_ENGINE_VERSION } from "./rules";
import type { GrahamInputs, ScreenResult } from "./types";

export interface GrahamAnalysis {
  engineVersion: string;
  classification: IndustryClassification;
  defensive: ScreenResult;
  enterprising: ScreenResult;
  netNet: NetNetResult;
  trends: TrendRow[];
  /** Provider "dividends" excluded as non-cash distributions (registry AI-DIST-FILTER). */
  excludedDistributions: ExcludedDistribution[];
}

export function analyzeGraham(inputs: GrahamInputs): GrahamAnalysis {
  const ctx = buildContext(inputs);
  const ev = dividendEvidence(inputs, ctx.annual);
  return {
    engineVersion: GRAHAM_ENGINE_VERSION,
    classification: ctx.classification,
    defensive: defensiveFromContext(ctx),
    enterprising: enterprisingFromContext(ctx),
    netNet: netNetFromContext(ctx),
    trends: buildTrends(ctx, ev.perYear),
    excludedDistributions: ev.screen.excluded,
  };
}

export { GRAHAM_ENGINE_VERSION };
export type { NetNetResult, TrendRow };
