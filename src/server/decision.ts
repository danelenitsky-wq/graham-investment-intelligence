import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  buildDecisionSnapshot,
  buildResearchReport,
  compareSnapshots,
  DECISION_ENGINE_VERSION,
  REPORT_TEMPLATE_VERSION,
  reportToMarkdown,
  type DecisionSnapshot,
  type ReportInputs,
  type ResearchReport,
  type SnapshotComparison,
  type SnapshotSource,
  type SnapshotTrigger,
  type Strategy,
} from "@/lib/decision";
import { GRAHAM_ENGINE_VERSION } from "@/lib/graham";
import { getDictionary, type Locale } from "@/lib/i18n";
import { VALUATION_DASHBOARD_VERSION } from "@/lib/valuation/engine";
import { INTRINSIC_MODEL_VERSION } from "@/lib/valuation/intrinsic";
import { db } from "./db";
import { getSecurityAnalysis, type SecurityAnalysis } from "./analysis";

export const DECISION_SNAPSHOT_ENGINE = "decision";

export const CALCULATION_VERSIONS = {
  graham: GRAHAM_ENGINE_VERSION,
  valuationDashboard: VALUATION_DASHBOARD_VERSION,
  intrinsicModel: INTRINSIC_MODEL_VERSION,
  decision: DECISION_ENGINE_VERSION,
  report: REPORT_TEMPLATE_VERSION,
};

export function reportInputsFromAnalysis(a: SecurityAnalysis, generatedAt = new Date().toISOString()): ReportInputs {
  return {
    security: a.security,
    price: a.price,
    quoteSourceName: a.quote.provider?.name ?? null,
    priceHistory: a.priceHistory,
    priceHistorySource: a.priceHistorySource,
    annual: a.annual,
    provenance: a.provenance,
    latestFiling: a.health.latestFiling,
    graham: a.graham,
    dashboard: a.valuationDashboard,
    intrinsic: a.intrinsic.result,
    marginOfSafetyTarget: a.settings.valuation.marginOfSafetyTarget,
    decision: a.decision,
    position: a.position,
    versions: {
      graham: CALCULATION_VERSIONS.graham,
      dashboard: CALCULATION_VERSIONS.valuationDashboard,
      intrinsic: CALCULATION_VERSIONS.intrinsicModel,
      decision: CALCULATION_VERSIONS.decision,
      report: CALCULATION_VERSIONS.report,
    },
    generatedAt,
  };
}

export function researchReport(a: SecurityAnalysis, locale: Locale, generatedAt?: string): ResearchReport {
  return buildResearchReport(reportInputsFromAnalysis(a, generatedAt), getDictionary(locale), locale);
}

/** Source references of everything the assessment read. */
export function snapshotSources(a: SecurityAnalysis): SnapshotSource[] {
  const out: SnapshotSource[] = [];
  const p = a.valuationDashboard.price.price;
  if (p) out.push({ kind: "QUOTE", label: p.source ?? "unknown", period: p.date, url: null, reference: p.timestamp, retrievedAt: a.quote.retrievedAt });
  if (a.priceHistory.length)
    out.push({
      kind: "PRICE",
      label: a.priceHistorySource ?? "unknown",
      period: `${a.priceHistory[0].date} – ${a.priceHistory[a.priceHistory.length - 1].date}`,
      url: null,
      reference: null,
      retrievedAt: null,
    });
  for (const pr of a.provenance)
    out.push({
      kind: "FILING",
      label: `${pr.sourceName}${pr.form ? ` ${pr.form}` : ""} FY${pr.fiscalYear}`,
      period: pr.periodEnd,
      url: pr.filingUrl,
      reference: pr.accessionNumber,
      retrievedAt: pr.retrievedAt,
    });
  return out;
}

export function snapshotFromAnalysis(a: SecurityAnalysis, trigger: SnapshotTrigger, createdAt = new Date().toISOString()): DecisionSnapshot {
  return buildDecisionSnapshot({
    createdAt,
    trigger,
    security: { id: a.security.id, ticker: a.security.ticker, exchangeCode: a.security.exchangeCode, name: a.security.name, cik: a.security.cik },
    graham: a.graham,
    dashboard: a.valuationDashboard,
    intrinsic: a.intrinsic.result,
    marginOfSafetyTarget: a.settings.valuation.marginOfSafetyTarget,
    decision: a.decision,
    decisionSettings: a.settings.decision,
    annual: a.annual,
    position: a.position,
    gate: a.health.gate,
    sources: snapshotSources(a),
    versions: CALCULATION_VERSIONS,
  });
}

export interface StoredDecisionSnapshot {
  id: string;
  computedAt: string;
  snapshot: DecisionSnapshot;
  reports: Partial<Record<Locale, string>>;
}

/**
 * Persist a timestamped decision snapshot (with the report in both languages).
 * Skipped when nothing changed since the latest snapshot (same inputs hash),
 * unless `force` is set.
 */
export async function persistDecisionSnapshot(
  a: SecurityAnalysis,
  trigger: SnapshotTrigger,
  options: { force?: boolean } = {},
): Promise<{ saved: boolean; id: string | null; snapshot: DecisionSnapshot }> {
  const createdAt = new Date().toISOString();
  const snapshot = snapshotFromAnalysis(a, trigger, createdAt);
  if (!options.force) {
    const latest = await db.analysisSnapshot.findFirst({
      where: { securityId: a.security.id, engine: DECISION_SNAPSHOT_ENGINE },
      orderBy: { computedAt: "desc" },
      select: { id: true, inputsHash: true },
    });
    if (latest?.inputsHash === snapshot.inputsHash) return { saved: false, id: latest.id, snapshot };
  }
  const reports = {
    he: reportToMarkdown(buildResearchReport(reportInputsFromAnalysis(a, createdAt), getDictionary("he"), "he")),
    en: reportToMarkdown(buildResearchReport(reportInputsFromAnalysis(a, createdAt), getDictionary("en"), "en")),
  };
  const row = await db.analysisSnapshot.create({
    data: {
      securityId: a.security.id,
      engine: DECISION_SNAPSHOT_ENGINE,
      engineVersion: DECISION_ENGINE_VERSION,
      methodology: "MODERN_EXTENSION",
      asOfDate: new Date((snapshot.inputs.price?.date ?? createdAt.slice(0, 10)) + "T00:00:00Z"),
      priceUsed: snapshot.inputs.price?.value ?? null,
      inputs: snapshot.inputs as unknown as Prisma.InputJsonValue,
      results: { snapshot, reports } as unknown as Prisma.InputJsonValue,
      dataQuality: { gate: a.health.gate, freshness: a.freshness } as unknown as Prisma.InputJsonValue,
      inputsHash: snapshot.inputsHash,
      usesDevFixtureData: a.freshness.usesDevFixtureData,
      computedAt: new Date(createdAt),
    },
  });
  return { saved: true, id: row.id, snapshot };
}

export async function saveDecisionSnapshot(securityId: string, options: { trigger?: SnapshotTrigger; strategy?: Strategy | null; force?: boolean } = {}) {
  const a = await getSecurityAnalysis(securityId, { strategy: options.strategy ?? null });
  if (!a) return { saved: false as const, id: null };
  const r = await persistDecisionSnapshot(a, options.trigger ?? "MANUAL", { force: options.force });
  return { saved: r.saved, id: r.id };
}

function parseStored(row: { id: string; computedAt: Date; results: unknown }): StoredDecisionSnapshot | null {
  const res = row.results as { snapshot?: DecisionSnapshot; reports?: Partial<Record<Locale, string>> } | null;
  if (!res?.snapshot || typeof res.snapshot !== "object" || !res.snapshot.assessment) return null;
  return { id: row.id, computedAt: row.computedAt.toISOString(), snapshot: res.snapshot, reports: res.reports ?? {} };
}

export async function listDecisionSnapshots(securityId: string, take = 50): Promise<StoredDecisionSnapshot[]> {
  const rows = await db.analysisSnapshot.findMany({
    where: { securityId, engine: DECISION_SNAPSHOT_ENGINE },
    orderBy: { computedAt: "desc" },
    take,
    select: { id: true, computedAt: true, results: true },
  });
  return rows.map(parseStored).filter((x): x is StoredDecisionSnapshot => x !== null);
}

export async function getDecisionSnapshot(id: string): Promise<StoredDecisionSnapshot | null> {
  const row = await db.analysisSnapshot.findUnique({ where: { id }, select: { id: true, computedAt: true, results: true, engine: true } });
  return row && row.engine === DECISION_SNAPSHOT_ENGINE ? parseStored(row) : null;
}

/** Compare two stored snapshots; the earlier one is always the "from" side. */
export function compareStored(x: StoredDecisionSnapshot, y: StoredDecisionSnapshot): SnapshotComparison {
  const [a, b] = x.snapshot.createdAt <= y.snapshot.createdAt ? [x, y] : [y, x];
  return compareSnapshots(a.snapshot, b.snapshot);
}
