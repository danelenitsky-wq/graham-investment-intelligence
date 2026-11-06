/**
 * Investment decision-support engine: application-defined research
 * classifications (not trading instructions, not Graham's rules) derived
 * deterministically from the Graham screens, the valuation engine, the
 * data-quality gate and the portfolio position. See ./engine.ts.
 */
export { evaluateDecision, DECISION_ENGINE_VERSION, PRICE_RULE_IDS, splitCriteria } from "./engine";
export * from "./types";
export { buildResearchReport, reportToMarkdown, REPORT_TEMPLATE_VERSION, REPORT_SECTION_IDS, type ResearchReport, type ReportSection, type ReportInputs } from "./report";
export {
  buildDecisionSnapshot,
  compareSnapshots,
  compareStatements,
  stableHash,
  SNAPSHOT_SCHEMA_VERSION,
  type DecisionSnapshot,
  type SnapshotComparison,
  type SnapshotSource,
  type SnapshotTrigger,
  type ChangeDriver,
  type StatementChange,
} from "./snapshot";
export { renderStatement, renderFactorReason, evidenceLabel, formatParam } from "./render";
