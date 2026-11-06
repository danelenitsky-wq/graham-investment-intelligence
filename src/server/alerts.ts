import "server-only";
import type { AlertType, Prisma } from "@/generated/prisma/client";
import {
  ALERT_KINDS,
  DEFAULT_ALERT_KINDS,
  evaluateAlerts,
  monitoringStatus,
  type AlertContext,
  type AlertKind,
  type AlertRule,
  type AlertState,
  type MonitoringStatus,
} from "@/lib/alerts";
import { findRule } from "@/lib/graham/rules";
import { db } from "./db";
import { env } from "./env";
import { getSecurityAnalysis, type SecurityAnalysis } from "./analysis";
import { getQuoteView } from "./quotes";
import { checkFilings } from "./filings";

const isKind = (t: string): t is AlertKind => (ALERT_KINDS as readonly string[]).includes(t);

/** Create the default rule set for a followed security (idempotent). */
export async function ensureDefaultAlerts(securityId: string) {
  await db.alert.createMany({ data: DEFAULT_ALERT_KINDS.map((type) => ({ securityId, type: type as AlertType })), skipDuplicates: true });
}

/** Keep the watchlist's custom target price and margin-of-safety target in sync with their alert rules. */
export async function syncWatchlistTargets(securityId: string, t: { targetPrice: number | null; targetCurrency: string | null; marginOfSafetyTarget: number | null }) {
  const upsert = async (type: AlertType, threshold: number | null, params: Prisma.InputJsonValue | undefined) => {
    if (threshold === null) {
      await db.alert.updateMany({ where: { securityId, type }, data: { status: "DISABLED" } });
      return;
    }
    const existing = await db.alert.findUnique({ where: { securityId_type: { securityId, type } } });
    const changed = !existing || Number(existing.threshold) !== threshold || JSON.stringify(existing.params) !== JSON.stringify(params ?? null);
    await db.alert.upsert({
      where: { securityId_type: { securityId, type } },
      create: { securityId, type, threshold, params, status: "ACTIVE" },
      // A new target starts a new episode.
      update: { threshold, params, status: "ACTIVE", ...(changed ? { state: { conditionMet: false } } : {}) },
    });
  };
  await upsert("CUSTOM_TARGET_PRICE", t.targetPrice, t.targetPrice !== null ? { currency: t.targetCurrency, direction: "AT_OR_BELOW" } : undefined);
  await upsert("MARGIN_OF_SAFETY_TARGET", t.marginOfSafetyTarget, undefined);
}

/** Context the pure evaluator needs, from the same analysis the pages show. */
export function alertContextFromAnalysis(a: SecurityAnalysis, today = new Date().toISOString().slice(0, 10)): AlertContext {
  const d = a.valuationDashboard;
  const current = d.price.basis === "CURRENT" && d.price.price ? d.price.price : null;
  const nn = findRule(a.graham.netNet.screen, "NN1");
  return {
    securityId: a.security.id,
    ticker: a.security.ticker,
    today,
    isEtf: a.graham.classification.industryClass === "ETF",
    currentPrice: current && d.price.comparable !== null && d.currency ? { value: d.price.comparable, currency: d.currency, date: current.date } : null,
    marketPrice: current ? { value: current.value, currency: current.currency, date: current.date } : null,
    priceIssue: current ? (d.price.comparable === null ? "CURRENCY_MISMATCH" : null) : (d.price.warning ?? "NO_CURRENT_PRICE"),
    fundamentalsExpected: a.security.market === "US",
    ceiling: a.decision.keyFigures.ceiling !== null && d.currency ? { value: a.decision.keyFigures.ceiling, strategy: a.decision.strategy, currency: d.currency } : null,
    marginOfSafety: a.decision.keyFigures.marginOfSafetyPercent === null ? null : a.decision.keyFigures.marginOfSafetyPercent / 100,
    latestFiling:
      a.health.latestFiling?.accessionNumber && a.health.latestFiling.filingDate
        ? { accessionNumber: a.health.latestFiling.accessionNumber, form: a.health.latestFiling.form ?? "", filingDate: a.health.latestFiling.filingDate }
        : null,
    annual: a.annual,
    dividends: a.dividends.map((x) => ({ exDate: x.exDate, amount: x.amount })),
    closes: a.priceHistory,
    netNetQualified: nn?.status === "PASS" ? true : nn?.status === "FAIL" ? false : null,
    quoteStatus: a.quote.status,
    quoteAsOf: a.price?.date ?? null,
    fundamentalsStatus: a.health.fundamentalsStatus.status,
    fundamentalsAsOf: a.freshness.fundamentals.asOf,
  };
}

export interface AlertRunSummary {
  runId: string;
  checked: number;
  newEvents: number;
  duplicates: number;
  providerCalls: number;
  skipped: number;
  errors: { securityId: string; ticker: string; error: string }[];
}

/** Securities the user follows: portfolio positions and watchlist items. */
async function followedSecurities() {
  const rows = await db.security.findMany({
    where: { OR: [{ positions: { some: {} } }, { watchlistItems: { some: {} } }] },
    select: { id: true, ticker: true },
    orderBy: { ticker: "asc" },
  });
  return rows;
}

/**
 * Evaluate every active alert rule of every followed security.
 *
 * With `fetch`, the run first refreshes data within the free plans' limits:
 * the daily SEC filings check (at most once per 24 h per security) and the
 * latest quote under the normal cache policy, stopping provider requests once
 * `maxProviderCalls` is reached (later securities are evaluated on stored
 * data). Without `fetch`, only stored data is read.
 */
export async function runAlertChecks(options: { trigger: "MANUAL" | "SCHEDULED" | "SCRIPT"; fetch?: boolean; maxProviderCalls?: number; now?: Date } = { trigger: "MANUAL" }): Promise<AlertRunSummary> {
  const run = await db.alertRun.create({ data: { trigger: options.trigger } });
  const budget = options.maxProviderCalls ?? 40;
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const summary: AlertRunSummary = { runId: run.id, checked: 0, newEvents: 0, duplicates: 0, providerCalls: 0, skipped: 0, errors: [] };
  for (const s of await followedSecurities()) {
    try {
      await ensureDefaultAlerts(s.id);
      let quote;
      if (options.fetch && summary.providerCalls < budget) {
        const f = await checkFilings(s.id);
        if (f.status !== "NOT_DUE" && f.status !== "SKIPPED") summary.providerCalls++;
        quote = await getQuoteView(s.id);
        summary.providerCalls += quote.attempts.length;
      }
      const a = await getSecurityAnalysis(s.id, { quote });
      if (!a) continue;
      const rules = await db.alert.findMany({ where: { securityId: s.id, status: "ACTIVE" } });
      const engineRules: AlertRule[] = rules
        .filter((r) => isKind(r.type))
        .map((r) => ({
          id: r.id,
          type: r.type as AlertKind,
          threshold: r.threshold === null ? null : Number(r.threshold),
          params: (r.params as AlertRule["params"]) ?? null,
          state: (r.state as AlertState | null) ?? null,
        }));
      const evaluations = evaluateAlerts(engineRules, alertContextFromAnalysis(a, today));
      for (const ev of evaluations) {
        if (ev.skipped && ev.skipped !== "BASELINE") summary.skipped++;
        let created = false;
        if (ev.event) {
          try {
            await db.alertEvent.create({
              data: {
                alertId: ev.ruleId,
                securityId: s.id,
                type: ev.event.type as AlertType,
                severity: ev.event.severity,
                dedupeKey: ev.event.dedupeKey,
                message: ev.event.message,
                params: ev.event.params as Prisma.InputJsonValue,
                observedValue: ev.event.observedValue,
                threshold: ev.event.threshold,
                runId: run.id,
              },
            });
            created = true;
            summary.newEvents++;
          } catch (e) {
            if ((e as { code?: string }).code === "P2002") summary.duplicates++;
            else throw e;
          }
        }
        await db.alert.update({
          where: { id: ev.ruleId },
          data: {
            lastEvaluatedAt: new Date(),
            state: ev.nextState as Prisma.InputJsonValue,
            ...(created ? { lastTriggeredAt: new Date() } : {}),
            note: ev.skipped && ev.skipped !== "BASELINE" ? `skipped: ${ev.skipped}` : null,
          },
        });
      }
      summary.checked++;
    } catch (e) {
      summary.errors.push({ securityId: s.id, ticker: s.ticker, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
  }
  await db.alertRun.update({
    where: { id: run.id },
    data: {
      completedAt: new Date(),
      checked: summary.checked,
      newEvents: summary.newEvents,
      duplicates: summary.duplicates,
      providerCalls: summary.providerCalls,
      skipped: summary.skipped,
      errors: summary.errors.length ? (summary.errors as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  return summary;
}

export interface MonitoringInfo {
  status: MonitoringStatus;
  schedulerConfigured: boolean;
  lastScheduledRunAt: string | null;
  lastRun: { trigger: string; startedAt: string; completedAt: string | null; checked: number; newEvents: number; duplicates: number; providerCalls: number; skipped: number } | null;
}

export async function getMonitoringInfo(now = new Date()): Promise<MonitoringInfo> {
  const [lastScheduled, last] = await Promise.all([
    db.alertRun.findFirst({ where: { trigger: "SCHEDULED", completedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
    db.alertRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);
  const schedulerConfigured = Boolean(env().CRON_SECRET);
  const lastScheduledRunAt = lastScheduled?.completedAt?.toISOString() ?? null;
  return {
    status: monitoringStatus({ schedulerConfigured, lastScheduledRunAt, now }),
    schedulerConfigured,
    lastScheduledRunAt,
    lastRun: last
      ? { trigger: last.trigger, startedAt: last.startedAt.toISOString(), completedAt: last.completedAt?.toISOString() ?? null, checked: last.checked, newEvents: last.newEvents, duplicates: last.duplicates, providerCalls: last.providerCalls, skipped: last.skipped }
      : null,
  };
}

export async function listAlertEvents(options: { take?: number; securityId?: string; unacknowledgedOnly?: boolean } = {}) {
  return db.alertEvent.findMany({
    where: { ...(options.securityId && { securityId: options.securityId }), ...(options.unacknowledgedOnly && { acknowledgedAt: null }) },
    orderBy: { triggeredAt: "desc" },
    take: options.take ?? 200,
  });
}

export async function listAlertRules() {
  return db.alert.findMany({ where: { securityId: { not: null } }, include: { security: { include: { exchange: true } } }, orderBy: [{ security: { ticker: "asc" } }, { type: "asc" }] });
}
