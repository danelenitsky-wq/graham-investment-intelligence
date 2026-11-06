/**
 * Timestamped decision snapshots and their comparison (pure).
 *
 * A snapshot freezes everything needed to explain and reproduce an
 * assessment: the data inputs, the source references, the calculation
 * versions, the valuation assumptions and the final assessment. Comparing two
 * snapshots shows how the assessment changed when a new price or new
 * financial statements arrived, and which input changed.
 */
import type { GrahamAnalysis } from "@/lib/graham";
import { findRule, ruleValue } from "@/lib/graham/rules";
import type { RuleStatus, SourceRef } from "@/lib/graham/types";
import type { AnnualFinancials } from "@/lib/normalization/statements";
import type { IntrinsicAssumptions, IntrinsicResult } from "@/lib/valuation/intrinsic";
import type { ValuationDashboard } from "@/lib/valuation/engine";
import type { GateResult } from "@/lib/freshness/gate";
import type { DecisionCategory, DecisionResult, DecisionSettings, FactorId, FactorStatus, PositionContext, Strategy } from "./types";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export type SnapshotTrigger = "MANUAL" | "REFRESH" | "SCRIPT";

export interface SnapshotSource {
  kind: SourceRef["kind"] | "QUOTE";
  label: string;
  period: string | null;
  url: string | null;
  /** Accession number of a filing, when known. */
  reference: string | null;
  /** When the application retrieved it (ISO), when known. */
  retrievedAt: string | null;
}

export interface SnapshotMetrics {
  price: number | null;
  ceiling: number | null;
  intrinsicValue: number | null;
  marginOfSafetyPercent: number | null;
  ncavPerShare: number | null;
  grahamNumber: number | null;
  averageEps3y: number | null;
  bookValuePerShare: number | null;
  currentRatio: number | null;
}

export interface DecisionSnapshot {
  schemaVersion: number;
  createdAt: string;
  trigger: SnapshotTrigger;
  security: { id: string; ticker: string; exchangeCode: string; name: string; cik: string | null };
  inputs: {
    price: { value: number; currency: string; date: string; status: string | null; source: string | null; timestamp: string | null } | null;
    priceBasis: ValuationDashboard["price"]["basis"];
    latestFiscalYear: number | null;
    latestPeriodEnd: string | null;
    /** Annual statements the engines read (the most recent years kept in full). */
    annual: AnnualFinancials[];
    position: PositionContext | null;
    gate: GateResult;
  };
  sources: SnapshotSource[];
  versions: { graham: string; valuationDashboard: string; intrinsicModel: string; decision: string; report: string };
  assumptions: {
    strategy: Strategy;
    selectedStrategy: Strategy;
    marginOfSafetyTarget: number;
    intrinsic: { status: IntrinsicResult["status"]; reason: string; assumptions: IntrinsicAssumptions } | null;
    decision: DecisionSettings;
  };
  /** Status of every counted Graham criterion (id → status). */
  rules: Record<string, RuleStatus>;
  metrics: SnapshotMetrics;
  assessment: DecisionResult;
  /** Hash of everything above except createdAt/trigger: unchanged inputs ⇒ same hash. */
  inputsHash: string;
}

/** Deterministic, dependency-free 64-bit FNV-1a hash (hex) of a JSON value. */
export function stableHash(value: unknown): string {
  const json = stableStringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export interface SnapshotParams {
  createdAt: string;
  trigger: SnapshotTrigger;
  security: DecisionSnapshot["security"];
  graham: GrahamAnalysis;
  dashboard: ValuationDashboard;
  intrinsic: IntrinsicResult | null;
  marginOfSafetyTarget: number;
  decision: DecisionResult;
  decisionSettings: DecisionSettings;
  annual: AnnualFinancials[];
  position: PositionContext | null;
  gate: GateResult;
  sources: SnapshotSource[];
  versions: DecisionSnapshot["versions"];
  /** Annual periods stored in full (default 12, enough for every Graham rule). */
  keepYears?: number;
}

export function snapshotMetrics(graham: GrahamAnalysis, dashboard: ValuationDashboard, decision: DecisionResult): SnapshotMetrics {
  const last = graham.trends[graham.trends.length - 1];
  return {
    price: dashboard.price.comparable,
    ceiling: decision.keyFigures.ceiling,
    intrinsicValue: decision.keyFigures.intrinsicValue,
    marginOfSafetyPercent: decision.keyFigures.marginOfSafetyPercent,
    ncavPerShare: graham.netNet.ncavPerShare,
    grahamNumber: dashboard.grahamNumber.ceiling.value,
    averageEps3y: ruleValue(findRule(graham.defensive, "D6"), "averageEps3y"),
    bookValuePerShare: ruleValue(findRule(graham.defensive, "D7"), "bookValuePerShare"),
    currentRatio: last?.currentRatio ?? null,
  };
}

export function buildDecisionSnapshot(p: SnapshotParams): DecisionSnapshot {
  const sorted = [...p.annual].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const last = sorted[sorted.length - 1] ?? null;
  const price = p.dashboard.price.price;
  const rules: Record<string, RuleStatus> = {};
  for (const s of [p.graham.defensive, p.graham.enterprising, p.graham.netNet.screen]) for (const r of s.rules) if (r.counted) rules[r.id] = r.status;
  const body: Omit<DecisionSnapshot, "createdAt" | "trigger" | "inputsHash"> = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    security: p.security,
    inputs: {
      price: price ? { value: price.value, currency: price.currency, date: price.date, status: price.quoteStatus, source: price.source, timestamp: price.timestamp } : null,
      priceBasis: p.dashboard.price.basis,
      latestFiscalYear: last?.fiscalYear ?? null,
      latestPeriodEnd: last?.periodEnd ?? null,
      annual: sorted.slice(-(p.keepYears ?? 12)),
      position: p.position,
      gate: p.gate,
    },
    sources: p.sources,
    versions: p.versions,
    assumptions: {
      strategy: p.decision.strategy,
      selectedStrategy: p.decision.selectedStrategy,
      marginOfSafetyTarget: p.marginOfSafetyTarget,
      intrinsic: p.intrinsic ? { status: p.intrinsic.status, reason: p.intrinsic.reason, assumptions: p.intrinsic.assumptions } : null,
      decision: p.decisionSettings,
    },
    rules,
    metrics: snapshotMetrics(p.graham, p.dashboard, p.decision),
    assessment: p.decision,
  };
  // Retrieval timestamps change on every refresh without changing the data; keep them out of the hash.
  const hashable = { ...body, sources: body.sources.map((s) => ({ ...s, retrievedAt: null })) };
  return { ...body, createdAt: p.createdAt, trigger: p.trigger, inputsHash: stableHash(hashable) };
}

// ─────────────────────────────── comparison ───────────────────────────────

export type ChangeDriver = "PRICE" | "FINANCIALS" | "ASSUMPTIONS" | "VERSION" | "OWNERSHIP" | "DATA_QUALITY";

export interface SnapshotComparison {
  from: { createdAt: string; category: DecisionCategory; strategy: Strategy };
  to: { createdAt: string; category: DecisionCategory; strategy: Strategy };
  categoryChanged: boolean;
  drivers: ChangeDriver[];
  price: { from: number | null; to: number | null; change: number | null; fromDate: string | null; toDate: string | null } | null;
  filings: { fromYear: number | null; toYear: number | null; revised: boolean } | null;
  factorChanges: { id: FactorId; from: FactorStatus; to: FactorStatus }[];
  ruleChanges: { id: string; from: RuleStatus | null; to: RuleStatus | null }[];
  metricChanges: { key: keyof SnapshotMetrics; from: number | null; to: number | null }[];
  addedTriggers: string[];
  removedTriggers: string[];
}

const near = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));

/** Compare an earlier snapshot (`a`) with a later one (`b`). */
export function compareSnapshots(a: DecisionSnapshot, b: DecisionSnapshot): SnapshotComparison {
  const drivers = new Set<ChangeDriver>();
  const pa = a.inputs.price;
  const pb = b.inputs.price;
  let price: SnapshotComparison["price"] = null;
  if (!near(pa?.value ?? null, pb?.value ?? null) || pa?.date !== pb?.date) {
    drivers.add("PRICE");
    price = {
      from: pa?.value ?? null,
      to: pb?.value ?? null,
      change: pa && pb && pa.value > 0 ? pb.value / pa.value - 1 : null,
      fromDate: pa?.date ?? null,
      toDate: pb?.date ?? null,
    };
  }
  let filings: SnapshotComparison["filings"] = null;
  const annualChanged = stableStringify(a.inputs.annual) !== stableStringify(b.inputs.annual);
  if (annualChanged || a.inputs.latestFiscalYear !== b.inputs.latestFiscalYear) {
    drivers.add("FINANCIALS");
    filings = { fromYear: a.inputs.latestFiscalYear, toYear: b.inputs.latestFiscalYear, revised: a.inputs.latestFiscalYear === b.inputs.latestFiscalYear };
  }
  if (stableStringify(a.assumptions) !== stableStringify(b.assumptions)) drivers.add("ASSUMPTIONS");
  if (stableStringify(a.versions) !== stableStringify(b.versions)) drivers.add("VERSION");
  if (stableStringify(a.inputs.position) !== stableStringify(b.inputs.position)) drivers.add("OWNERSHIP");
  if (stableStringify(a.inputs.gate) !== stableStringify(b.inputs.gate) || a.inputs.priceBasis !== b.inputs.priceBasis) drivers.add("DATA_QUALITY");

  const fa = new Map(a.assessment.factors.map((f) => [f.id, f.status]));
  const factorChanges = b.assessment.factors.filter((f) => fa.get(f.id) !== f.status).map((f) => ({ id: f.id, from: fa.get(f.id) ?? "UNKNOWN", to: f.status }));
  const ids = [...new Set([...Object.keys(a.rules), ...Object.keys(b.rules)])].sort();
  const ruleChanges = ids.filter((id) => a.rules[id] !== b.rules[id]).map((id) => ({ id, from: a.rules[id] ?? null, to: b.rules[id] ?? null }));
  const keys = Object.keys(b.metrics) as (keyof SnapshotMetrics)[];
  const metricChanges = keys.filter((k) => !near(a.metrics[k], b.metrics[k])).map((k) => ({ key: k, from: a.metrics[k], to: b.metrics[k] }));
  const ta = new Set(a.assessment.reviewTriggers.map((t) => t.code));
  const tb = new Set(b.assessment.reviewTriggers.map((t) => t.code));
  return {
    from: { createdAt: a.createdAt, category: a.assessment.category, strategy: a.assessment.strategy },
    to: { createdAt: b.createdAt, category: b.assessment.category, strategy: b.assessment.strategy },
    categoryChanged: a.assessment.category !== b.assessment.category,
    drivers: [...drivers],
    price,
    filings,
    factorChanges,
    ruleChanges,
    metricChanges,
    addedTriggers: [...tb].filter((x) => !ta.has(x)),
    removedTriggers: [...ta].filter((x) => !tb.has(x)),
  };
}
