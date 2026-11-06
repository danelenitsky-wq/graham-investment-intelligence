/**
 * Alert evaluation (pure, deterministic).
 *
 * Each rule is evaluated against an `AlertContext` assembled from stored data
 * (the same analysis the pages show). The result is at most one event draft
 * plus the rule's next state. Duplicate prevention has two layers:
 *
 * 1. Edge triggering: price / margin-of-safety / Net-Net / filing alerts fire
 *    on the transition into the condition (state.conditionMet false → true,
 *    or a new filing accession), not on every run while it holds.
 * 2. A deterministic `dedupeKey` per occurrence (security + type + the
 *    occurrence: price date, fiscal year, accession, last dividend…). The
 *    database enforces it as unique, so a repeated run can never record the
 *    same occurrence twice even if the state was lost.
 *
 * Conditions are only judged on data that supports them: price alerts need a
 * current (non-stale) price in the statements' currency; financial alerts
 * need both fiscal years' figures (missing ≠ zero); dividend interruption
 * needs price history that reaches the present, and ignores provider
 * "dividends" that are really share distributions (e.g. the 2014 GOOGL Class C
 * issuance that Tiingo lists as a $567.97 dividend).
 */
import { screenDistributions } from "@/lib/graham/dividends";
import type { AnnualFinancials } from "@/lib/normalization/statements";

export const ALERT_KINDS = [
  "GRAHAM_PURCHASE_THRESHOLD",
  "CUSTOM_TARGET_PRICE",
  "MARGIN_OF_SAFETY_TARGET",
  "NEW_FILING",
  "CURRENT_RATIO_DETERIORATION",
  "DEBT_INCREASE",
  "EARNINGS_DETERIORATION",
  "DIVIDEND_INTERRUPTION",
  "NET_NET_CHANGE",
  "DATA_STALE",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Rules created for every followed security (custom target and MoS target need a value first). */
export const DEFAULT_ALERT_KINDS: AlertKind[] = [
  "GRAHAM_PURCHASE_THRESHOLD",
  "NEW_FILING",
  "CURRENT_RATIO_DETERIORATION",
  "DEBT_INCREASE",
  "EARNINGS_DETERIORATION",
  "DIVIDEND_INTERRUPTION",
  "NET_NET_CHANGE",
  "DATA_STALE",
];

/** Default thresholds (application assumptions, editable per rule). */
export const ALERT_DEFAULTS = {
  /** Current ratio falls by at least this fraction year over year. */
  currentRatioDrop: 0.1,
  /** Graham's defensive minimum; crossing below it always alerts. */
  currentRatioFloor: 2,
  /** Long-term debt rises by at least this fraction year over year. */
  debtIncrease: 0.2,
  /** EPS falls by at least this fraction year over year (a swing to a loss always alerts). */
  earningsDrop: 0.25,
  /** Days without the expected dividend beyond the usual interval (and at least 1.5×). */
  dividendGraceDays: 45,
  /** Price history must reach this close to today before "no dividend" is evidence. */
  dividendDataMaxLagDays: 10,
  /** An interruption older than this is history, not news. */
  dividendLookbackYears: 3,
};

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface AlertState {
  conditionMet?: boolean;
  /** Date (or key) the current episode started; part of the dedupe key. */
  episode?: string | null;
  lastAccession?: string | null;
  netNetQualified?: boolean | null;
  lastValue?: number | null;
}

export interface AlertRule {
  id: string;
  type: AlertKind;
  /** Price (major unit), fraction (MoS target / drops), or null for the default. */
  threshold: number | null;
  params: { currency?: string | null; direction?: "AT_OR_BELOW" | "AT_OR_ABOVE" } | null;
  state: AlertState | null;
}

export interface AlertContext {
  securityId: string;
  ticker: string;
  today: string;
  isEtf: boolean;
  /** Price in the statements' currency when the valuation basis is CURRENT; otherwise null. */
  currentPrice: { value: number; currency: string; date: string } | null;
  /** The current market price in its trading currency (custom targets); null when not current. */
  marketPrice: { value: number; currency: string; date: string } | null;
  /** False where no free fundamentals source exists (TASE): stale-fundamentals warnings are not raised. */
  fundamentalsExpected: boolean;
  /** Why there is no current price (for skip reasons). */
  priceIssue: string | null;
  /** Strategy price ceiling (Graham purchase threshold) in the statements' currency. */
  ceiling: { value: number; strategy: string; currency: string } | null;
  /** Margin of safety vs intrinsic value (fraction), when established. */
  marginOfSafety: number | null;
  latestFiling: { accessionNumber: string; form: string; filingDate: string } | null;
  annual: AnnualFinancials[];
  dividends: { exDate: string; amount: number }[];
  closes: { date: string; close: number }[];
  /** Net-Net NN1 status: true PASS, false FAIL, null not determinable / not applicable. */
  netNetQualified: boolean | null;
  quoteStatus: string;
  quoteAsOf: string | null;
  fundamentalsStatus: string;
  fundamentalsAsOf: string | null;
}

export interface AlertEventDraft {
  type: AlertKind;
  severity: AlertSeverity;
  dedupeKey: string;
  /** i18n code under alerts.messages. */
  message: string;
  params: Record<string, string | number>;
  observedValue: number | null;
  threshold: number | null;
}

export interface AlertEvaluation {
  ruleId: string;
  type: AlertKind;
  event: AlertEventDraft | null;
  nextState: AlertState;
  /** Why the rule could not be judged this run (state unchanged). */
  skipped: string | null;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const key = (...parts: (string | number)[]) => parts.join(":");

function lastTwo(annual: AnnualFinancials[], pick: (a: AnnualFinancials) => number | null) {
  const sorted = [...annual].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const last = sorted[sorted.length - 1];
  const prev = sorted.find((a) => last && a.fiscalYear === last.fiscalYear - 1);
  if (!last || !prev) return null;
  const x = pick(prev);
  const y = pick(last);
  if (x === null || y === null) return null;
  return { prev: x, last: y, fiscalYear: last.fiscalYear, prevYear: prev.fiscalYear };
}

const cr = (a: AnnualFinancials) => {
  const ca = a.values.currentAssets;
  const cl = a.values.currentLiabilities;
  return ca !== undefined && cl !== undefined && cl > 0 ? ca / cl : null;
};
const ltd = (a: AnnualFinancials) => (a.values.longTermDebt === undefined ? null : a.values.longTermDebt);
const eps = (a: AnnualFinancials) => a.values.epsDiluted ?? a.values.epsBasic ?? null;

function skip(rule: AlertRule, reason: string): AlertEvaluation {
  return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: reason };
}

/** Edge-triggered level condition (price ≤ x, MoS ≥ y). */
function edge(rule: AlertRule, met: boolean, date: string, draft: () => Omit<AlertEventDraft, "dedupeKey" | "type">, ctx: AlertContext): AlertEvaluation {
  const was = rule.state?.conditionMet === true;
  if (!met) return { ruleId: rule.id, type: rule.type, event: null, nextState: { ...rule.state, conditionMet: false, episode: null }, skipped: null };
  if (was) return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: null };
  const d = draft();
  return {
    ruleId: rule.id,
    type: rule.type,
    event: { ...d, type: rule.type, dedupeKey: key(rule.type, ctx.securityId, rule.threshold ?? "default", date) },
    nextState: { ...rule.state, conditionMet: true, episode: date },
    skipped: null,
  };
}

export function evaluateRule(rule: AlertRule, ctx: AlertContext): AlertEvaluation {
  const companyOnly: AlertKind[] = ["GRAHAM_PURCHASE_THRESHOLD", "MARGIN_OF_SAFETY_TARGET", "CURRENT_RATIO_DETERIORATION", "DEBT_INCREASE", "EARNINGS_DETERIORATION", "NET_NET_CHANGE"];
  if (ctx.isEtf && companyOnly.includes(rule.type)) return skip(rule, "NOT_APPLICABLE_ETF");

  switch (rule.type) {
    case "GRAHAM_PURCHASE_THRESHOLD": {
      if (!ctx.ceiling) return skip(rule, "NO_CEILING");
      if (!ctx.currentPrice) return skip(rule, ctx.priceIssue ?? "NO_CURRENT_PRICE");
      if (ctx.currentPrice.currency !== ctx.ceiling.currency) return skip(rule, "CURRENCY_MISMATCH");
      const p = ctx.currentPrice;
      const c = ctx.ceiling;
      return edge(rule, p.value <= c.value, p.date, () => ({
        severity: "INFO",
        message: "grahamThreshold",
        params: { ticker: ctx.ticker, price: p.value, ceiling: c.value, currency: p.currency, strategy: c.strategy, date: p.date },
        observedValue: p.value,
        threshold: c.value,
      }), ctx);
    }
    case "CUSTOM_TARGET_PRICE": {
      if (rule.threshold === null || !(rule.threshold > 0)) return skip(rule, "NO_TARGET");
      if (!ctx.marketPrice) return skip(rule, ctx.priceIssue ?? "NO_CURRENT_PRICE");
      const cur = rule.params?.currency ?? null;
      if (!cur || cur !== ctx.marketPrice.currency) return skip(rule, "CURRENCY_MISMATCH");
      const dir = rule.params?.direction ?? "AT_OR_BELOW";
      const p = ctx.marketPrice;
      const t = rule.threshold;
      const met = dir === "AT_OR_BELOW" ? p.value <= t : p.value >= t;
      return edge(rule, met, p.date, () => ({
        severity: "INFO",
        message: dir === "AT_OR_BELOW" ? "customTargetBelow" : "customTargetAbove",
        params: { ticker: ctx.ticker, price: p.value, target: t, currency: p.currency, date: p.date },
        observedValue: p.value,
        threshold: t,
      }), ctx);
    }
    case "MARGIN_OF_SAFETY_TARGET": {
      if (rule.threshold === null) return skip(rule, "NO_TARGET");
      if (!ctx.currentPrice) return skip(rule, ctx.priceIssue ?? "NO_CURRENT_PRICE");
      if (ctx.marginOfSafety === null) return skip(rule, "NO_INTRINSIC_VALUE");
      const m = ctx.marginOfSafety;
      const t = rule.threshold;
      return edge(rule, m >= t, ctx.currentPrice.date, () => ({
        severity: "INFO",
        message: "marginOfSafety",
        params: { ticker: ctx.ticker, mos: Math.round(m * 1000) / 10, target: Math.round(t * 1000) / 10, date: ctx.currentPrice!.date },
        observedValue: m,
        threshold: t,
      }), ctx);
    }
    case "NEW_FILING": {
      const f = ctx.latestFiling;
      if (!f) return skip(rule, "NO_FILING_DATA");
      const last = rule.state?.lastAccession ?? null;
      // The first check records a baseline: only filings published after alerts were set up are "new".
      if (last === null) return { ruleId: rule.id, type: rule.type, event: null, nextState: { ...rule.state, lastAccession: f.accessionNumber }, skipped: "BASELINE" };
      if (last === f.accessionNumber) return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: null };
      return {
        ruleId: rule.id,
        type: rule.type,
        event: {
          type: rule.type,
          severity: "INFO",
          dedupeKey: key(rule.type, ctx.securityId, f.accessionNumber),
          message: "newFiling",
          params: { ticker: ctx.ticker, form: f.form, date: f.filingDate, accession: f.accessionNumber },
          observedValue: null,
          threshold: null,
        },
        nextState: { ...rule.state, lastAccession: f.accessionNumber },
        skipped: null,
      };
    }
    case "CURRENT_RATIO_DETERIORATION": {
      const r = lastTwo(ctx.annual, cr);
      if (!r) return skip(rule, "INSUFFICIENT_FINANCIALS");
      const drop = rule.threshold ?? ALERT_DEFAULTS.currentRatioDrop;
      const fellBelowFloor = r.prev >= ALERT_DEFAULTS.currentRatioFloor && r.last < ALERT_DEFAULTS.currentRatioFloor;
      const dropped = r.last < r.prev * (1 - drop);
      if (!fellBelowFloor && !dropped) return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: null };
      return fyEvent(rule, ctx, r.fiscalYear, {
        severity: "WARNING",
        message: fellBelowFloor ? "currentRatioBelowFloor" : "currentRatioDrop",
        params: { ticker: ctx.ticker, from: round(r.prev, 2), to: round(r.last, 2), fy: r.fiscalYear, prevFy: r.prevYear, floor: ALERT_DEFAULTS.currentRatioFloor },
        observedValue: r.last,
        threshold: fellBelowFloor ? ALERT_DEFAULTS.currentRatioFloor : r.prev * (1 - drop),
      });
    }
    case "DEBT_INCREASE": {
      const r = lastTwo(ctx.annual, ltd);
      if (!r) return skip(rule, "INSUFFICIENT_FINANCIALS");
      const inc = rule.threshold ?? ALERT_DEFAULTS.debtIncrease;
      const rose = r.prev === 0 ? r.last > 0 : r.last > r.prev * (1 + inc);
      if (!rose) return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: null };
      return fyEvent(rule, ctx, r.fiscalYear, {
        severity: "WARNING",
        message: r.prev === 0 ? "debtFromZero" : "debtIncrease",
        params: { ticker: ctx.ticker, from: r.prev, to: r.last, change: r.prev === 0 ? 0 : round((r.last / r.prev - 1) * 100, 1), fy: r.fiscalYear, prevFy: r.prevYear, currency: lastCurrency(ctx.annual) },
        observedValue: r.last,
        threshold: r.prev * (1 + inc),
      });
    }
    case "EARNINGS_DETERIORATION": {
      const r = lastTwo(ctx.annual, eps);
      if (!r) return skip(rule, "INSUFFICIENT_FINANCIALS");
      const drop = rule.threshold ?? ALERT_DEFAULTS.earningsDrop;
      const toLoss = r.prev >= 0 && r.last < 0;
      const fell = r.prev > 0 && r.last < r.prev * (1 - drop);
      if (!toLoss && !fell) return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: null };
      return fyEvent(rule, ctx, r.fiscalYear, {
        severity: toLoss ? "CRITICAL" : "WARNING",
        message: toLoss ? "earningsToLoss" : "earningsDrop",
        params: { ticker: ctx.ticker, from: r.prev, to: r.last, change: r.prev > 0 ? round((r.last / r.prev - 1) * 100, 1) : 0, fy: r.fiscalYear, prevFy: r.prevYear },
        observedValue: r.last,
        threshold: r.prev * (1 - drop),
      });
    }
    case "DIVIDEND_INTERRUPTION":
      return dividendInterruption(rule, ctx);
    case "NET_NET_CHANGE": {
      const now = ctx.netNetQualified;
      if (now === null) return skip(rule, "NOT_DETERMINABLE");
      const before = rule.state?.netNetQualified;
      if (before === undefined || before === null) return { ruleId: rule.id, type: rule.type, event: null, nextState: { ...rule.state, netNetQualified: now }, skipped: "BASELINE" };
      if (before === now) return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: null };
      const date = ctx.currentPrice?.date ?? ctx.today;
      return {
        ruleId: rule.id,
        type: rule.type,
        event: {
          type: rule.type,
          severity: now ? "INFO" : "WARNING",
          dedupeKey: key(rule.type, ctx.securityId, now ? "QUALIFIED" : "NOT_QUALIFIED", date),
          message: now ? "netNetQualified" : "netNetLost",
          params: { ticker: ctx.ticker, date },
          observedValue: null,
          threshold: null,
        },
        nextState: { ...rule.state, netNetQualified: now },
        skipped: null,
      };
    }
    case "DATA_STALE": {
      const stalePrice = ctx.quoteStatus === "STALE" || ctx.quoteStatus === "UNAVAILABLE";
      const staleFundamentals = !ctx.isEtf && ctx.fundamentalsExpected && (ctx.fundamentalsStatus === "STALE" || ctx.fundamentalsStatus === "UNAVAILABLE");
      if (!stalePrice && !staleFundamentals) return { ruleId: rule.id, type: rule.type, event: null, nextState: { ...rule.state, conditionMet: false }, skipped: null };
      const parts = [stalePrice ? `P${ctx.quoteAsOf ?? "none"}` : null, staleFundamentals ? `F${ctx.fundamentalsAsOf ?? "none"}` : null].filter(Boolean).join("|");
      // One warning per distinct stale data point: a new price or filing that is still stale re-arms it.
      if (rule.state?.episode === parts) return { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state, skipped: null };
      return {
        ruleId: rule.id,
        type: rule.type,
        event: {
          type: rule.type,
          severity: "WARNING",
          dedupeKey: key(rule.type, ctx.securityId, parts),
          message: stalePrice && staleFundamentals ? "staleBoth" : stalePrice ? "stalePrice" : "staleFundamentals",
          params: { ticker: ctx.ticker, priceAsOf: ctx.quoteAsOf ?? "—", fundamentalsAsOf: ctx.fundamentalsAsOf ?? "—", quoteStatus: ctx.quoteStatus, fundamentalsStatus: ctx.fundamentalsStatus },
          observedValue: null,
          threshold: null,
        },
        nextState: { ...rule.state, conditionMet: true, episode: parts },
        skipped: null,
      };
    }
  }
}

function fyEvent(rule: AlertRule, ctx: AlertContext, fy: number, d: Omit<AlertEventDraft, "dedupeKey" | "type">): AlertEvaluation {
  return { ruleId: rule.id, type: rule.type, event: { ...d, type: rule.type, dedupeKey: key(rule.type, ctx.securityId, `FY${fy}`) }, nextState: { ...rule.state, lastValue: d.observedValue }, skipped: null };
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const lastCurrency = (annual: AnnualFinancials[]) => [...annual].sort((a, b) => a.fiscalYear - b.fiscalYear).at(-1)?.currency ?? "";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cash dividends that stopped arriving at their usual interval, or an explicit zero after a paying year. */
export function dividendInterruption(rule: AlertRule, ctx: AlertContext): AlertEvaluation {
  const none = { ruleId: rule.id, type: rule.type, event: null, nextState: rule.state ?? {}, skipped: null };
  // 1) Reported by the filings: dividends per share > 0 last year, explicitly 0 this year.
  const r = lastTwo(ctx.annual, (a) => (a.values.dividendsPerShare === undefined ? null : a.values.dividendsPerShare));
  if (r && r.prev > 0 && r.last === 0) {
    return fyEvent(rule, ctx, r.fiscalYear, {
      severity: "WARNING",
      message: "dividendStoppedFiling",
      params: { ticker: ctx.ticker, fy: r.fiscalYear, prevFy: r.prevYear, from: r.prev },
      observedValue: 0,
      threshold: null,
    });
  }
  // 2) From the provider's dividend history, after removing non-cash distributions.
  const closes = [...ctx.closes].sort((a, b) => a.date.localeCompare(b.date));
  const lastBar = closes[closes.length - 1];
  if (!lastBar) return skip(rule, "NO_PRICE_HISTORY");
  if (daysBetween(lastBar.date, ctx.today) > ALERT_DEFAULTS.dividendDataMaxLagDays) return skip(rule, "PRICE_HISTORY_NOT_CURRENT");
  const kept = screenDistributions(ctx.dividends, closes).kept.sort((a, b) => a.exDate.localeCompare(b.exDate));
  if (kept.length < 2) return kept.length === 0 ? skip(rule, "NO_DIVIDEND_HISTORY") : none;
  const recent = kept.slice(-9);
  const gaps = recent.slice(1).map((d, i) => daysBetween(recent[i].exDate, d.exDate)).filter((g) => g > 0);
  if (!gaps.length) return none;
  const usual = median(gaps);
  const last = kept[kept.length - 1];
  const since = daysBetween(last.exDate, ctx.today);
  const limit = Math.max(usual * 1.5, usual + ALERT_DEFAULTS.dividendGraceDays);
  if (since <= limit) return none;
  if (since > 365 * ALERT_DEFAULTS.dividendLookbackYears + limit) return skip(rule, "LONG_STANDING");
  return {
    ruleId: rule.id,
    type: rule.type,
    event: {
      type: rule.type,
      severity: "WARNING",
      dedupeKey: key(rule.type, ctx.securityId, `after-${last.exDate}`),
      message: "dividendOverdue",
      params: { ticker: ctx.ticker, lastExDate: last.exDate, lastAmount: last.amount, days: since, usual: Math.round(usual) },
      observedValue: since,
      threshold: Math.round(limit),
    },
    nextState: { ...rule.state, lastValue: since },
    skipped: null,
  };
}

export function evaluateAlerts(rules: AlertRule[], ctx: AlertContext): AlertEvaluation[] {
  return rules.map((r) => evaluateRule(r, ctx));
}

/**
 * Background monitoring status. "ACTIVE" only when a scheduler is configured
 * (shared secret set) AND a scheduled run actually completed within
 * `maxGapHours`. Otherwise the app says exactly what it knows.
 */
export type MonitoringStatus = "ACTIVE" | "CONFIGURED_NOT_RUNNING" | "OVERDUE" | "NOT_CONFIGURED";

export function monitoringStatus(input: { schedulerConfigured: boolean; lastScheduledRunAt: string | null; now: Date; maxGapHours?: number }): MonitoringStatus {
  if (!input.schedulerConfigured) return "NOT_CONFIGURED";
  if (!input.lastScheduledRunAt) return "CONFIGURED_NOT_RUNNING";
  const gapH = (input.now.getTime() - Date.parse(input.lastScheduledRunAt)) / 3_600_000;
  return gapH <= (input.maxGapHours ?? 26) ? "ACTIVE" : "OVERDUE";
}
