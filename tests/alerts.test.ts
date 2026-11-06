import { describe, expect, it } from "vitest";
import { evaluateRule, monitoringStatus, type AlertContext, type AlertKind, type AlertRule } from "@/lib/alerts";
import type { AnnualFinancials } from "@/lib/normalization/statements";

const fy = (fiscalYear: number, values: AnnualFinancials["values"]): AnnualFinancials => ({ fiscalYear, periodEnd: `${fiscalYear}-12-31`, currency: "USD", values });

function ctx(over: Partial<AlertContext> = {}): AlertContext {
  return {
    securityId: "s1",
    ticker: "KO",
    today: "2026-11-06",
    isEtf: false,
    currentPrice: { value: 50, currency: "USD", date: "2026-11-05" },
    marketPrice: { value: 50, currency: "USD", date: "2026-11-05" },
    fundamentalsExpected: true,
    priceIssue: null,
    ceiling: { value: 55, strategy: "DEFENSIVE", currency: "USD" },
    marginOfSafety: 0.35,
    latestFiling: { accessionNumber: "acc-2", form: "10-K", filingDate: "2026-02-20" },
    annual: [fy(2024, { currentAssets: 300, currentLiabilities: 100, longTermDebt: 100, epsDiluted: 2, dividendsPerShare: 1 }), fy(2025, { currentAssets: 300, currentLiabilities: 100, longTermDebt: 100, epsDiluted: 2, dividendsPerShare: 1 })],
    dividends: [],
    closes: [{ date: "2026-11-05", close: 50 }],
    netNetQualified: false,
    quoteStatus: "LAST_CLOSE",
    quoteAsOf: "2026-11-05",
    fundamentalsStatus: "FRESH",
    fundamentalsAsOf: "2026-02-20",
    ...over,
  };
}
const rule = (type: AlertKind, over: Partial<AlertRule> = {}): AlertRule => ({ id: `r-${type}`, type, threshold: null, params: null, state: null, ...over });

describe("price alerts", () => {
  it("fire once on crossing the Graham purchase threshold, then re-arm only after leaving it", () => {
    const r = rule("GRAHAM_PURCHASE_THRESHOLD");
    const first = evaluateRule(r, ctx());
    expect(first.event).toMatchObject({ message: "grahamThreshold", observedValue: 50, threshold: 55, dedupeKey: "GRAHAM_PURCHASE_THRESHOLD:s1:default:2026-11-05" });
    const second = evaluateRule({ ...r, state: first.nextState }, ctx({ currentPrice: { value: 49, currency: "USD", date: "2026-11-06" } }));
    expect(second.event).toBeNull();
    const out = evaluateRule({ ...r, state: second.nextState }, ctx({ currentPrice: { value: 60, currency: "USD", date: "2026-11-07" } }));
    expect(out.event).toBeNull();
    expect(out.nextState.conditionMet).toBe(false);
    expect(evaluateRule({ ...r, state: out.nextState }, ctx({ currentPrice: { value: 54, currency: "USD", date: "2026-11-08" } })).event).not.toBeNull();
  });

  it("are not judged without a current price or across currencies", () => {
    expect(evaluateRule(rule("GRAHAM_PURCHASE_THRESHOLD"), ctx({ currentPrice: null, priceIssue: "PRICE_NOT_CURRENT" })).skipped).toBe("PRICE_NOT_CURRENT");
    expect(evaluateRule(rule("GRAHAM_PURCHASE_THRESHOLD"), ctx({ ceiling: { value: 200, strategy: "DEFENSIVE", currency: "ILS" } })).skipped).toBe("CURRENCY_MISMATCH");
    expect(evaluateRule(rule("CUSTOM_TARGET_PRICE", { threshold: 60, params: { currency: "ILS" } }), ctx()).skipped).toBe("CURRENCY_MISMATCH");
    expect(evaluateRule(rule("CUSTOM_TARGET_PRICE"), ctx()).skipped).toBe("NO_TARGET");
  });

  it("support custom targets in both directions and margin-of-safety targets", () => {
    expect(evaluateRule(rule("CUSTOM_TARGET_PRICE", { threshold: 52, params: { currency: "USD" } }), ctx()).event?.message).toBe("customTargetBelow");
    expect(evaluateRule(rule("CUSTOM_TARGET_PRICE", { threshold: 52, params: { currency: "USD", direction: "AT_OR_ABOVE" } }), ctx()).event).toBeNull();
    expect(evaluateRule(rule("MARGIN_OF_SAFETY_TARGET", { threshold: 0.3 }), ctx()).event).toMatchObject({ message: "marginOfSafety", params: { mos: 35, target: 30 } });
    expect(evaluateRule(rule("MARGIN_OF_SAFETY_TARGET", { threshold: 0.4 }), ctx()).event).toBeNull();
    expect(evaluateRule(rule("MARGIN_OF_SAFETY_TARGET", { threshold: 0.3 }), ctx({ marginOfSafety: null })).skipped).toBe("NO_INTRINSIC_VALUE");
  });
});

describe("filing and financial alerts", () => {
  it("record a filing baseline first, then alert on a new accession only", () => {
    const base = evaluateRule(rule("NEW_FILING"), ctx());
    expect(base).toMatchObject({ event: null, skipped: "BASELINE", nextState: { lastAccession: "acc-2" } });
    expect(evaluateRule(rule("NEW_FILING", { state: base.nextState }), ctx()).event).toBeNull();
    const next = evaluateRule(rule("NEW_FILING", { state: base.nextState }), ctx({ latestFiling: { accessionNumber: "acc-3", form: "10-Q", filingDate: "2026-11-01" } }));
    expect(next.event).toMatchObject({ dedupeKey: "NEW_FILING:s1:acc-3", params: { form: "10-Q" } });
  });

  it("flag current ratio, debt and earnings deterioration per fiscal year", () => {
    const worse = ctx({ annual: [fy(2024, { currentAssets: 300, currentLiabilities: 100, longTermDebt: 100, epsDiluted: 2 }), fy(2025, { currentAssets: 190, currentLiabilities: 100, longTermDebt: 130, epsDiluted: -0.1 })] });
    expect(evaluateRule(rule("CURRENT_RATIO_DETERIORATION"), worse).event).toMatchObject({ message: "currentRatioBelowFloor", dedupeKey: "CURRENT_RATIO_DETERIORATION:s1:FY2025" });
    expect(evaluateRule(rule("DEBT_INCREASE"), worse).event).toMatchObject({ message: "debtIncrease", params: { change: 30 } });
    expect(evaluateRule(rule("EARNINGS_DETERIORATION"), worse).event).toMatchObject({ message: "earningsToLoss", severity: "CRITICAL" });
    expect(evaluateRule(rule("DEBT_INCREASE", { threshold: 0.5 }), worse).event).toBeNull();
    const ok = ctx();
    for (const t of ["CURRENT_RATIO_DETERIORATION", "DEBT_INCREASE", "EARNINGS_DETERIORATION"] as const) expect(evaluateRule(rule(t), ok).event).toBeNull();
  });

  it("treat missing figures as unknown, not zero", () => {
    const gap = ctx({ annual: [fy(2024, { currentAssets: 300 }), fy(2025, { currentAssets: 100, currentLiabilities: 100 })] });
    expect(evaluateRule(rule("CURRENT_RATIO_DETERIORATION"), gap).skipped).toBe("INSUFFICIENT_FINANCIALS");
    expect(evaluateRule(rule("DEBT_INCREASE"), gap).skipped).toBe("INSUFFICIENT_FINANCIALS");
    expect(evaluateRule(rule("EARNINGS_DETERIORATION"), ctx({ annual: [fy(2025, { epsDiluted: 1 })] })).skipped).toBe("INSUFFICIENT_FINANCIALS");
  });

  it("skip company-only alerts for ETFs", () => {
    for (const t of ["GRAHAM_PURCHASE_THRESHOLD", "MARGIN_OF_SAFETY_TARGET", "CURRENT_RATIO_DETERIORATION", "DEBT_INCREASE", "EARNINGS_DETERIORATION", "NET_NET_CHANGE"] as const) {
      expect(evaluateRule(rule(t, { threshold: 0.3 }), ctx({ isEtf: true })).skipped).toBe("NOT_APPLICABLE_ETF");
    }
    expect(evaluateRule(rule("CUSTOM_TARGET_PRICE", { threshold: 52, params: { currency: "USD" } }), ctx({ isEtf: true })).event).not.toBeNull();
  });
});

describe("dividend interruption", () => {
  const quarterly = (from: number, to: number) => {
    const out: { exDate: string; amount: number }[] = [];
    for (let y = from; y <= to; y++) for (const m of ["03", "06", "09", "12"]) out.push({ exDate: `${y}-${m}-14`, amount: 0.5 });
    return out;
  };

  it("alerts when the usual quarterly dividend is overdue, once per last payment", () => {
    const divs = quarterly(2023, 2025).concat([{ exDate: "2026-03-14", amount: 0.5 }]);
    const e = evaluateRule(rule("DIVIDEND_INTERRUPTION"), ctx({ annual: [], dividends: divs }));
    expect(e.event).toMatchObject({ message: "dividendOverdue", dedupeKey: "DIVIDEND_INTERRUPTION:s1:after-2026-03-14", params: { usual: 92 } });
    expect(evaluateRule(rule("DIVIDEND_INTERRUPTION"), ctx({ annual: [], dividends: quarterly(2023, 2026) })).event).toBeNull();
  });

  it("ignores the GOOGL-style $567.97 share distribution", () => {
    // A single huge "dividend" with no cash dividend history must not create a dividend pattern.
    const closes = [{ date: "2014-03-26", close: 1150 }, { date: "2014-04-02", close: 1135 }, { date: "2026-11-05", close: 170 }];
    const e = evaluateRule(rule("DIVIDEND_INTERRUPTION"), ctx({ annual: [], closes, dividends: [{ exDate: "2014-04-02", amount: 567.97 }] }));
    expect(e.event).toBeNull();
    expect(e.skipped).toBe("NO_DIVIDEND_HISTORY");
  });

  it("uses a reported zero dividend after a paying year, and needs current price history otherwise", () => {
    const stop = evaluateRule(rule("DIVIDEND_INTERRUPTION"), ctx({ annual: [fy(2024, { dividendsPerShare: 1.2 }), fy(2025, { dividendsPerShare: 0 })] }));
    expect(stop.event).toMatchObject({ message: "dividendStoppedFiling", dedupeKey: "DIVIDEND_INTERRUPTION:s1:FY2025" });
    expect(evaluateRule(rule("DIVIDEND_INTERRUPTION"), ctx({ annual: [], closes: [{ date: "2026-09-01", close: 50 }], dividends: quarterly(2023, 2025) })).skipped).toBe("PRICE_HISTORY_NOT_CURRENT");
  });
});

describe("Net-Net and stale data", () => {
  it("record a Net-Net baseline, then alert on a change", () => {
    const b = evaluateRule(rule("NET_NET_CHANGE"), ctx());
    expect(b.skipped).toBe("BASELINE");
    const changed = evaluateRule(rule("NET_NET_CHANGE", { state: b.nextState }), ctx({ netNetQualified: true }));
    expect(changed.event).toMatchObject({ message: "netNetQualified", dedupeKey: "NET_NET_CHANGE:s1:QUALIFIED:2026-11-05" });
    expect(evaluateRule(rule("NET_NET_CHANGE"), ctx({ netNetQualified: null })).skipped).toBe("NOT_DETERMINABLE");
  });

  it("warn once per stale data point and not about fundamentals where no free source exists", () => {
    const stale = ctx({ quoteStatus: "STALE", quoteAsOf: "2026-10-01" });
    const e = evaluateRule(rule("DATA_STALE"), stale);
    expect(e.event).toMatchObject({ message: "stalePrice", dedupeKey: "DATA_STALE:s1:P2026-10-01" });
    expect(evaluateRule(rule("DATA_STALE", { state: e.nextState }), stale).event).toBeNull();
    expect(evaluateRule(rule("DATA_STALE"), ctx({ fundamentalsStatus: "UNAVAILABLE", fundamentalsExpected: false })).event).toBeNull();
    expect(evaluateRule(rule("DATA_STALE"), ctx({ fundamentalsStatus: "UNAVAILABLE" })).event?.message).toBe("staleFundamentals");
  });
});

describe("monitoring status", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("is ACTIVE only with a configured scheduler that actually ran recently", () => {
    expect(monitoringStatus({ schedulerConfigured: false, lastScheduledRunAt: "2026-11-06T11:00:00Z", now })).toBe("NOT_CONFIGURED");
    expect(monitoringStatus({ schedulerConfigured: true, lastScheduledRunAt: null, now })).toBe("CONFIGURED_NOT_RUNNING");
    expect(monitoringStatus({ schedulerConfigured: true, lastScheduledRunAt: "2026-11-06T02:00:00Z", now })).toBe("ACTIVE");
    expect(monitoringStatus({ schedulerConfigured: true, lastScheduledRunAt: "2026-11-04T02:00:00Z", now })).toBe("OVERDUE");
  });
});
