/**
 * Net-Net (net current asset value) analysis — Chapter 15, "Bargain issues,
 * or net-current-asset stocks".
 *
 *   NCAV            = Current Assets − Total Liabilities
 *   NCAV per share  = NCAV / Shares Outstanding
 *   Purchase limit  = 2/3 × NCAV per share   (registry NN1, wording UNVERIFIED)
 *
 * A numerical net-net qualification is NOT a buy recommendation. The risk
 * indicators below (registry AI-RISK) are informational: they use this
 * application's thresholds and never change a rule status.
 */
import { average, eps, type Num } from "./metrics";
import { absentMeansNone, currentDebtNoted, longTermDebtNoted, sharesNoted, totalLiabilitiesNoted, type Noted } from "./metrics";
import { check, filingSources, fyLabel, input, isApplicable, makeRule, notApplicable, periodLabel, priceSources, summarize, type EvalContext } from "./rules";
import type { InputValue, ScreenResult, SourceRef } from "./types";

export const NET_NET_THRESHOLDS = { purchaseFraction: 2 / 3 } as const;

/** Application thresholds for the risk indicators (registry AI-RISK). */
export const RISK_THRESHOLDS = {
  runwayYearsWatch: 3,
  operatingLossYears: 5,
  operatingLossesHigh: 3,
  maturityToCashLow: 0.5,
  growthGapWatch: 0.1,
  dilutionWatch: 0.02,
  dilutionHigh: 0.05,
} as const;

export type RiskLevel = "LOW" | "WATCH" | "HIGH" | "INSUFFICIENT_DATA";
export type RiskId = "cashBurn" | "operatingLosses" | "debtMaturity" | "workingCapitalQuality" | "dilution";

export interface RiskIndicator {
  id: RiskId;
  level: RiskLevel;
  values: InputValue[];
  reason: string;
  reasonParams?: Record<string, string | number>;
  period: string | null;
  sources: SourceRef[];
}

export interface NetNetResult {
  screen: ScreenResult;
  ncav: Num;
  ncavPerShare: Num;
  purchaseThreshold: Num;
  risks: RiskIndicator[];
}

const v = (n: number | undefined): Num => (n === undefined ? null : n);

export function netNetFromContext(ctx: EvalContext): NetNetResult {
  const cls = ctx.classification.industryClass;
  const L = ctx.lastYear;
  const a = ctx.last;
  const ca = v(a?.values.currentAssets);
  const tl = totalLiabilitiesNoted(a);
  const shares = sharesNoted(a);
  const ncav = ca !== null && tl.value !== null ? ca - tl.value : null;
  const ncavPerShare = ncav !== null && shares.value !== null ? ncav / shares.value : null;
  const threshold = ncavPerShare === null ? null : NET_NET_THRESHOLDS.purchaseFraction * ncavPerShare;

  let rule;
  if (!isApplicable(cls, "NN1")) rule = notApplicable("NN1", "NET_NET", cls);
  else if (L === null) rule = makeRule("NN1", "NET_NET", { formula: "Price ≤ 2/3 × (CA − TL) / Shares", inputs: [], checks: [], status: "INSUFFICIENT_DATA", reason: "noFinancials" });
  else {
    const pref = a?.values.preferredStock;
    const ncavCheck = check("ncav", ncav, ">", 0, "currency");
    const priceCheck = check("price", ctx.price, "<=", threshold, "perShare", ncav !== null && ncav <= 0 && ctx.price !== null ? false : undefined);
    rule = makeRule("NN1", "NET_NET", {
      formula: "NCAV = CA − TL;  Price ≤ 2/3 × NCAV / Shares",
      inputs: [
        input("currentAssets", ca, "currency", L),
        input("totalLiabilities", tl, "currency", L),
        input("ncav", ncav === null ? null : { value: ncav, note: "derived" }, "currency", L),
        ...(pref !== undefined && pref !== 0 && ncav !== null ? [input("ncavAfterPreferred", { value: ncav - pref, note: "derived" }, "currency", L)] : []),
        input("sharesOutstanding", shares, "shares", L),
        input("ncavPerShare", ncavPerShare, "perShare", L),
        input("netNetThreshold", threshold, "perShare", L),
        input("price", ctx.price, "perShare"),
        input("priceToNcav", ctx.price !== null && ncavPerShare !== null && ncavPerShare > 0 ? ctx.price / ncavPerShare : null, "multiple"),
      ],
      checks: [ncavCheck, priceCheck],
      reason: (s) =>
        s === "PASS"
          ? "belowNetNetThreshold"
          : s === "FAIL"
            ? ncavCheck.passed === false
              ? "nonPositiveNcav"
              : "aboveNetNetThreshold"
            : ctx.priceReason ?? (ca === null ? "missingCurrentItems" : tl.value === null ? "missingTotalLiabilities" : "missingShares"),
      assumptions: ["NN-NCAV", "X-NCAVPS", "AI-PRICE", "AI-SHARES"],
      sources: [...priceSources(ctx), ...filingSources(ctx, [L])],
      period: fyLabel(ctx, L),
    });
  }
  const screen = summarize("NET_NET", [rule], cls);
  const risks = isApplicable(cls, "NN1") && L !== null ? riskIndicators(ctx) : [];
  return { screen, ncav, ncavPerShare, purchaseThreshold: threshold, risks };
}

function growth(now: Num, before: Num): Num {
  if (now === null || before === null || before <= 0) return null;
  return now / before - 1;
}

export function riskIndicators(ctx: EvalContext): RiskIndicator[] {
  const R = RISK_THRESHOLDS;
  const L = ctx.lastYear!;
  const a = ctx.last!;
  const prev = ctx.map.get(L - 1) ?? null;
  const src = (years: number[]) => filingSources(ctx, years.filter((y) => ctx.map.has(y)));
  const out: RiskIndicator[] = [];

  // Cash burn: free cash flow and runway.
  {
    const ocf = v(a.values.operatingCashFlow);
    const capex = v(a.values.capitalExpenditures);
    const cash = v(a.values.cashAndEquivalents);
    const fcf = ocf !== null && capex !== null ? ocf - capex : null;
    const burnBound = fcf ?? (ocf !== null && ocf < 0 ? ocf : null); // capex ≥ 0, so FCF ≤ OCF
    const runway = burnBound !== null && burnBound < 0 && cash !== null ? cash / -burnBound : null;
    let level: RiskLevel = "INSUFFICIENT_DATA";
    let reason = "missingCashFlow";
    if (burnBound !== null) {
      if (burnBound >= 0) [level, reason] = ["LOW", "positiveFreeCashFlow"];
      else if (runway === null) [level, reason] = ["WATCH", "burningCashUnknownRunway"];
      else if (runway >= R.runwayYearsWatch) [level, reason] = ["WATCH", "burningCash"];
      else [level, reason] = ["HIGH", "shortRunway"];
    }
    out.push({
      id: "cashBurn",
      level,
      values: [
        input("operatingCashFlow", ocf, "currency", L),
        input("capitalExpenditures", capex, "currency", L),
        input("freeCashFlow", fcf === null ? (burnBound === null ? null : { value: burnBound, note: "lowerBound" }) : { value: fcf, note: "derived" }, "currency", L),
        input("cashAndEquivalents", cash, "currency", L),
        input("runwayYears", runway, "ratio"),
      ],
      reason,
      reasonParams: { runwayYears: runway === null ? "—" : runway.toFixed(1) },
      period: fyLabel(ctx, L),
      sources: src([L]),
    });
  }

  // Operating losses over five years.
  {
    const years = Array.from({ length: R.operatingLossYears }, (_, i) => L - R.operatingLossYears + 1 + i);
    const vals = years.map((y) => [y, v(ctx.map.get(y)?.values.operatingIncome)] as const);
    const known = vals.filter(([, x]) => x !== null);
    const losses = known.filter(([, x]) => x! < 0).map(([y]) => y);
    const latestLoss = (vals[vals.length - 1][1] ?? 0) < 0;
    let level: RiskLevel;
    let reason: string;
    if (known.length === 0) [level, reason] = ["INSUFFICIENT_DATA", "missingOperatingIncome"];
    else if (latestLoss || losses.length >= R.operatingLossesHigh) [level, reason] = ["HIGH", "operatingLosses"];
    else if (losses.length > 0) [level, reason] = ["WATCH", "operatingLosses"];
    else if (known.length < 3) [level, reason] = ["INSUFFICIENT_DATA", "historyTooShort"];
    else [level, reason] = ["LOW", "noOperatingLosses"];
    out.push({
      id: "operatingLosses",
      level,
      values: vals.map(([y, x]) => input("operatingIncome", x, "currency", y)),
      reason,
      reasonParams: { lossYears: losses.join(", ") || "—", known: known.length, years: R.operatingLossYears },
      period: periodLabel(ctx, years),
      sources: src(years),
    });
  }

  // Debt maturities within a year vs. cash.
  {
    const cur = currentDebtNoted(a, ctx.provenance.get(L)?.concepts?.debtCurrent);
    const maturing = v(a.values.debtMaturingNext12m);
    const ltd = longTermDebtNoted(a);
    const cash = v(a.values.cashAndEquivalents);
    const due = [cur.value, maturing].filter((x): x is number => x !== null);
    const dueAmount = due.length ? Math.max(...due) : null;
    let level: RiskLevel = "INSUFFICIENT_DATA";
    let reason = "missingDebtMaturities";
    if (dueAmount !== null) {
      if (dueAmount === 0) [level, reason] = ["LOW", "noNearTermMaturities"];
      else if (cash === null) [level, reason] = ["WATCH", "maturitiesCashUnknown"];
      else if (dueAmount <= R.maturityToCashLow * cash) [level, reason] = ["LOW", "maturitiesCovered"];
      else if (dueAmount <= cash) [level, reason] = ["WATCH", "maturitiesMostlyCovered"];
      else [level, reason] = ["HIGH", "maturitiesExceedCash"];
    } else if (ltd.value === 0) [level, reason] = ["LOW", "noNearTermMaturities"];
    out.push({
      id: "debtMaturity",
      level,
      values: [
        input("currentDebt", cur, "currency", L),
        input("debtMaturingNext12m", maturing, "currency", L),
        input("longTermDebt", ltd, "currency", L),
        input("cashAndEquivalents", cash, "currency", L),
        input("maturitiesToCash", dueAmount !== null && cash !== null && cash > 0 ? dueAmount / cash : null, "ratio"),
      ],
      reason,
      period: fyLabel(ctx, L),
      sources: src([L]),
    });
  }

  // Receivables and inventory quality: growth vs. sales, share of current assets.
  {
    const rec = v(a.values.accountsReceivable);
    const inv = v(a.values.inventory);
    const recPrev = v(prev?.values.accountsReceivable);
    const invPrev = v(prev?.values.inventory);
    const rev = v(a.values.revenue);
    const revPrev = v(prev?.values.revenue);
    const gRev = growth(rev, revPrev);
    const gRec = growth(rec, recPrev);
    const gInv = growth(inv, invPrev);
    const ca = v(a.values.currentAssets);
    const parts = [rec, inv].filter((x): x is number => x !== null);
    const share = ca !== null && ca > 0 && parts.length ? parts.reduce((s, x) => s + x, 0) / ca : null;
    const flags: string[] = [];
    if (gRec !== null && gRev !== null && gRec - gRev > R.growthGapWatch) flags.push("receivables");
    if (gInv !== null && gInv - (gRev ?? 0) > R.growthGapWatch && gRev !== null) flags.push("inventory");
    const comparable = gRev !== null && (gRec !== null || gInv !== null);
    let level: RiskLevel;
    let reason: string;
    if (rec === null && inv === null) [level, reason] = ["INSUFFICIENT_DATA", "missingWorkingCapitalItems"];
    else if (!comparable) [level, reason] = ["INSUFFICIENT_DATA", "historyTooShort"];
    else if (flags.length >= 2) [level, reason] = ["HIGH", "growingFasterThanSales"];
    else if (flags.length === 1) [level, reason] = ["WATCH", "growingFasterThanSales"];
    else [level, reason] = ["LOW", "inLineWithSales"];
    out.push({
      id: "workingCapitalQuality",
      level,
      values: [
        input("accountsReceivable", rec, "currency", L),
        input("inventory", inv, "currency", L),
        input("receivablesGrowth", gRec, "percent"),
        input("inventoryGrowth", gInv, "percent"),
        input("revenueGrowth", gRev, "percent"),
        input("receivablesInventoryShareOfCa", share, "percent", L),
      ],
      reason,
      reasonParams: { flagged: flags.join(", ") || "—" },
      period: periodLabel(ctx, [L - 1, L]),
      sources: src([L - 1, L]),
    });
  }

  // Dilution: change in shares outstanding.
  {
    const s = (y: number): Noted => sharesNoted(ctx.map.get(y) ?? null);
    const now = s(L).value;
    const y1 = s(L - 1).value;
    const y3 = s(L - 3).value;
    const g1 = growth(now, y1);
    const g3 = now !== null && y3 !== null && y3 > 0 ? Math.pow(now / y3, 1 / 3) - 1 : null;
    const worst = Math.max(g1 ?? -Infinity, g3 ?? -Infinity);
    let level: RiskLevel;
    let reason: string;
    if (g1 === null && g3 === null) [level, reason] = ["INSUFFICIENT_DATA", "missingShareHistory"];
    else if (worst > R.dilutionHigh) [level, reason] = ["HIGH", "dilutive"];
    else if (worst > R.dilutionWatch) [level, reason] = ["WATCH", "dilutive"];
    else [level, reason] = ["LOW", "noMaterialDilution"];
    out.push({
      id: "dilution",
      level,
      values: [
        input("sharesOutstanding", now, "shares", L),
        input("sharesOneYearAgo", y1, "shares", L - 1),
        input("sharesThreeYearsAgo", y3, "shares", L - 3),
        input("shareChange1y", g1, "percent"),
        input("shareChangeAnnual3y", g3, "percent"),
      ],
      reason,
      period: periodLabel(ctx, [L - 3, L]),
      sources: src([L - 3, L - 1, L]),
    });
  }

  return out;
}

export interface TrendRow {
  fiscalYear: number;
  revenue: Num;
  netIncome: Num;
  operatingIncome: Num;
  eps: Num;
  eps3yAvg: Num;
  dividendsPerShare: Num;
  /** Cash dividends per share paid in the fiscal year, from the price provider (after screening). */
  providerDividends: Num;
  currentRatio: Num;
  netWorkingCapital: Num;
  longTermDebt: Num;
  bookValuePerShare: Num;
  tangibleBookValuePerShare: Num;
  ncav: Num;
  ncavPerShare: Num;
  sharesOutstanding: Num;
  freeCashFlow: Num;
}

/** Per-fiscal-year series for the panels' history charts. Missing values stay null. */
export function buildTrends(ctx: EvalContext, providerDividends: Map<number, number>, maxYears = 25): TrendRow[] {
  const rows: TrendRow[] = [];
  for (const a of ctx.annual.slice(-maxYears)) {
    const y = a.fiscalYear;
    const x = a.values;
    const ca = v(x.currentAssets);
    const cl = v(x.currentLiabilities);
    const tl = totalLiabilitiesNoted(a).value;
    const shares = sharesNoted(a).value;
    const pref = absentMeansNone(a, "preferredStock").value;
    const gw = absentMeansNone(a, "goodwill").value;
    const intang = absentMeansNone(a, "intangibleAssets").value;
    const equity = x.stockholdersEquity !== undefined && pref !== null ? x.stockholdersEquity - pref : null;
    const tangible = equity !== null && gw !== null && intang !== null ? equity - gw - intang : null;
    const ncav = ca !== null && tl !== null ? ca - tl : null;
    const per = (n: Num) => (n !== null && shares !== null ? n / shares : null);
    rows.push({
      fiscalYear: y,
      revenue: v(x.revenue),
      netIncome: v(x.netIncome),
      operatingIncome: v(x.operatingIncome),
      eps: eps(a),
      eps3yAvg: average([y - 2, y - 1, y].map((k) => eps(ctx.map.get(k)))),
      dividendsPerShare: v(x.dividendsPerShare),
      providerDividends: providerDividends.has(y) ? providerDividends.get(y)! : null,
      currentRatio: ca !== null && cl !== null && cl > 0 ? ca / cl : null,
      netWorkingCapital: ca !== null && cl !== null ? ca - cl : null,
      longTermDebt: longTermDebtNoted(a).value,
      bookValuePerShare: per(equity),
      tangibleBookValuePerShare: per(tangible),
      ncav,
      ncavPerShare: per(ncav),
      sharesOutstanding: shares,
      freeCashFlow: x.operatingCashFlow !== undefined && x.capitalExpenditures !== undefined ? x.operatingCashFlow - x.capitalExpenditures : null,
    });
  }
  return rows;
}
