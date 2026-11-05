/**
 * Synthetic scenarios for the decision-engine tests: the real Graham,
 * valuation and intrinsic-value engines run on test-only data (no market data).
 */
import { analyzeGraham } from "@/lib/graham";
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { buildValuationDashboard, resolvePriceContext } from "@/lib/valuation/engine";
import { buildIntrinsicBase, computeIntrinsicValue, defaultAssumptions } from "@/lib/valuation/intrinsic";
import type { GateResult } from "@/lib/freshness/gate";
import type { FreshnessReport } from "@/lib/freshness";
import type { QuoteStatus } from "@/lib/freshness/quote";
import { DEFAULT_DECISION_SETTINGS, evaluateDecision, type DecisionInputs, type DecisionSettings, type PositionContext, type Strategy, type VerificationCounts } from "@/lib/decision";
import { year } from "./helpers";

type Values = Partial<Record<CanonicalConcept, number>>;

/** A sound industrial company: 22 fiscal years to 2024, EPS 2.00 → 10.40, dividends every year, risk data reported. */
export function soundCompany(over: (fy: number, i: number) => Values = () => ({})): AnnualFinancials[] {
  const out: AnnualFinancials[] = [];
  for (let i = 0; i < 22; i++) {
    const fy = 2003 + i;
    const eps = 2 + i * 0.4;
    out.push(
      year(fy, {
        revenue: 1_000_000_000,
        operatingIncome: eps * 10_000_000 * 1.4,
        netIncome: eps * 10_000_000,
        epsDiluted: eps,
        dilutedShares: 10_000_000,
        dividendsPerShare: 1,
        totalAssets: 2_000_000_000,
        currentAssets: 900_000_000,
        cashAndEquivalents: 200_000_000,
        accountsReceivable: 100_000_000,
        inventory: 150_000_000,
        currentLiabilities: 300_000_000,
        longTermDebt: 400_000_000,
        debtCurrent: 0,
        debtMaturingNext12m: 0,
        totalLiabilities: 800_000_000,
        stockholdersEquity: 1_200_000_000,
        sharesOutstanding: 10_000_000,
        operatingCashFlow: eps * 10_000_000 * 1.2,
        capitalExpenditures: 20_000_000,
        ...over(fy, i),
      }),
    );
  }
  return out;
}

export const OK_GATE: GateResult = { sufficient: true, missing: [], stale: [], conflicting: [], notes: [] };

export interface ScenarioOptions {
  annual?: AnnualFinancials[];
  price?: number | null;
  priceDate?: string;
  quoteStatus?: QuoteStatus;
  strategy?: Strategy;
  position?: Partial<PositionContext> | null;
  gate?: Partial<GateResult>;
  intrinsicEnabled?: boolean;
  settings?: Partial<DecisionSettings>;
  verification?: VerificationCounts | null;
  marginOfSafetyTarget?: number;
  issues?: FreshnessReport["issues"];
  industry?: { sicCode?: string };
}

export function scenario(o: ScenarioOptions = {}) {
  const annual = o.annual ?? soundCompany();
  const date = o.priceDate ?? "2025-03-03";
  const price = o.price === undefined ? 60 : o.price;
  const last = annual[annual.length - 1];
  const classification = o.industry?.sicCode
    ? { industryClass: o.industry.sicCode.startsWith("60") ? ("BANK" as const) : ("INDUSTRIAL" as const), basis: "SIC" as const, sicCode: o.industry.sicCode }
    : undefined;
  const graham = analyzeGraham({ annual, price: price === null ? null : { value: price, date, currency: "USD" }, classification });
  const dashboard = buildValuationDashboard({
    graham,
    currency: "USD",
    price: resolvePriceContext({
      quote: price === null ? null : { value: price, currency: "USD", date, timestamp: `${date}T21:00:00Z`, source: "Tiingo", quoteStatus: o.quoteStatus ?? "LAST_CLOSE" },
      statementCurrency: "USD",
      today: date,
      staleAfterDays: 10,
    }),
  });
  const base = buildIntrinsicBase(annual, graham.classification.industryClass);
  const defaults = defaultAssumptions(base, { enabled: o.intrinsicEnabled ?? true });
  const intrinsic = computeIntrinsicValue(base, defaults.assumptions);
  const gate: GateResult = { ...OK_GATE, ...o.gate };
  if (o.gate) gate.sufficient = (gate.missing.length + gate.stale.length + gate.conflicting.length === 0) && !gate.notes.includes("DEV_FIXTURE");
  const position: PositionContext | null =
    o.position === undefined || o.position === null
      ? null
      : { quantity: 100, averageCost: 50, currency: "USD", weight: 0.1, marketValue: price === null ? null : 100 * price, thesisStrategy: "DEFENSIVE", openedAt: "2020-01-02", ...o.position };
  const inputs: DecisionInputs = {
    strategy: o.strategy ?? "DEFENSIVE",
    graham,
    dashboard,
    intrinsic,
    marginOfSafetyTarget: o.marginOfSafetyTarget ?? 0.3,
    gate,
    freshness: {
      prices: { level: "FRESH", asOf: date, ageDays: 0, isDevFixture: false },
      fundamentals: { level: "FRESH", asOf: last?.periodEnd ?? null, ageDays: 62, isDevFixture: false },
      issues: o.issues ?? [],
      usesDevFixtureData: false,
    },
    verification: o.verification === undefined ? { verified: 12, conflict: 0, singleSource: 0, unverified: 0 } : o.verification,
    position,
    settings: { ...DEFAULT_DECISION_SETTINGS, ...o.settings },
    fundamentalsStaleMonths: 24,
  };
  return { inputs, graham, dashboard, intrinsic, annual, decision: evaluateDecision(inputs) };
}
