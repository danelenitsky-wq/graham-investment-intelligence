/**
 * Timestamped decision snapshots and their comparison (pure).
 *
 * A snapshot freezes everything needed to explain and reproduce an
 * assessment: the data inputs, the source references, the calculation
 * versions, the valuation assumptions and the final assessment. Comparing two
 * snapshots shows how the assessment changed when a new price or new
 * financial statements arrived, and which input changed.
 */
import { createHash } from "node:crypto";
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

/** Identifies the hashing scheme, stored implicitly by the "sha256:" prefix of every hash. */
export const HASH_ALGORITHM = "sha256";

/**
 * Deterministic SHA-256 (hex, prefixed "sha256:") of a value's canonical
 * serialization (see canonicalJson). Equal inputs always give the same hash;
 * a change anywhere in the input, at any depth, gives a different one.
 *
 * Uses Node's crypto module, so it runs on the server and in scripts only.
 */
export function stableHash(value: unknown): string {
  return `${HASH_ALGORITHM}:${createHash(HASH_ALGORITHM).update(canonicalJson(value), "utf8").digest("hex")}`;
}

/**
 * Canonical JSON: object keys sorted by code point, no whitespace, keys whose
 * value is undefined left out (as JSON.stringify does). Values JSON cannot
 * represent faithfully are encoded explicitly instead of collapsing to null or
 * {}, so they cannot collide with real data:
 *   NaN / ±Infinity → {"$num":"NaN"|"Infinity"|"-Infinity"}
 *   Date            → {"$date":"<ISO 8601>"}
 *   bigint          → {"$bigint":"<decimal>"}
 * Objects with toJSON() (other than Date) are serialized through it.
 * Functions, symbols, Maps, Sets and circular references throw: silently
 * dropping them would make different inputs hash the same.
 */
export function canonicalJson(value: unknown): string {
  return canon(value, new Set());
}

/** @deprecated Kept as an alias; use canonicalJson. */
export const stableStringify = canonicalJson;

function canon(v: unknown, seen: Set<object>): string {
  if (v === null || v === undefined) return "null";
  switch (typeof v) {
    case "string":
    case "boolean":
      return JSON.stringify(v);
    case "number":
      return Number.isFinite(v) ? JSON.stringify(v) : `{"$num":${JSON.stringify(String(v))}}`;
    case "bigint":
      return `{"$bigint":${JSON.stringify(v.toString())}}`;
    case "function":
    case "symbol":
      throw new TypeError(`canonicalJson: cannot hash a ${typeof v}`);
  }
  const o = v as object;
  if (o instanceof Date) {
    if (Number.isNaN(o.getTime())) throw new TypeError("canonicalJson: invalid Date");
    return `{"$date":${JSON.stringify(o.toISOString())}}`;
  }
  if (o instanceof Map || o instanceof Set) throw new TypeError("canonicalJson: Map/Set are not supported; convert to arrays or objects first");
  if (seen.has(o)) throw new TypeError("canonicalJson: circular reference");
  seen.add(o);
  try {
    if (Array.isArray(o)) return `[${o.map((x) => canon(x, seen)).join(",")}]`;
    const withToJson = o as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === "function") return canon(withToJson.toJSON(), seen);
    const rec = o as Record<string, unknown>;
    return `{${Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(rec[k], seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(o);
  }
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
  /** Per fiscal year: statement inputs that were added, revised or dropped between the snapshots. */
  statementChanges: StatementChange[];
  addedTriggers: string[];
  removedTriggers: string[];
}

export interface StatementChange {
  fiscalYear: number;
  kind: "NEW" | "REVISED" | "REMOVED";
  concepts: { concept: string; from: number | null; to: number | null }[];
}

/** Compare the annual statement inputs of two snapshots, year by year and concept by concept. */
export function compareStatements(a: AnnualFinancials[], b: AnnualFinancials[]): StatementChange[] {
  const ya = new Map(a.map((y) => [y.fiscalYear, y]));
  const yb = new Map(b.map((y) => [y.fiscalYear, y]));
  const years = [...new Set([...ya.keys(), ...yb.keys()])].sort((x, y) => y - x);
  const out: StatementChange[] = [];
  for (const fy of years) {
    const x = ya.get(fy);
    const y = yb.get(fy);
    const vx = (x?.values ?? {}) as Record<string, number | undefined>;
    const vy = (y?.values ?? {}) as Record<string, number | undefined>;
    const keys = [...new Set([...Object.keys(vx), ...Object.keys(vy)])].sort();
    const concepts = keys
      .filter((k) => !near(vx[k] ?? null, vy[k] ?? null))
      .map((k) => ({ concept: k, from: vx[k] ?? null, to: vy[k] ?? null }));
    if (concepts.length === 0) continue;
    out.push({ fiscalYear: fy, kind: !x ? "NEW" : !y ? "REMOVED" : "REVISED", concepts });
  }
  return out;
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
    statementChanges: compareStatements(a.inputs.annual ?? [], b.inputs.annual ?? []),
    addedTriggers: [...tb].filter((x) => !ta.has(x)),
    removedTriggers: [...ta].filter((x) => !tb.has(x)),
  };
}
