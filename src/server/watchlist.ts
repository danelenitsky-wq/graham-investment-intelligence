import "server-only";
import type { DecisionCategory, Strategy } from "@/lib/decision";
import type { QuoteStatus } from "@/lib/freshness/quote";
import type { DataStatus } from "@/lib/freshness/status";
import type { ScreenOutcome } from "@/lib/graham/types";
import { db } from "./db";
import { getQuoteView } from "./quotes";
import { ensureDefaultAlerts, syncWatchlistTargets } from "./alerts";

export async function getDefaultWatchlist() {
  const existing = await db.watchlist.findFirst({ where: { isDefault: true } });
  if (existing) return existing;
  return db.watchlist.create({ data: { name: "Default", isDefault: true } });
}

export async function getWatchlistWithItems() {
  const wl = await getDefaultWatchlist();
  const items = await db.watchlistItem.findMany({
    where: { watchlistId: wl.id },
    orderBy: { addedAt: "desc" },
    include: {
      security: {
        include: {
          exchange: true,
          source: true,
          priceBars: { orderBy: { date: "desc" }, take: 2, include: { source: true } },
          snapshots: { where: { engine: "graham-defensive" }, orderBy: { computedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  return { watchlist: wl, items };
}

export async function isOnWatchlist(securityId: string) {
  const wl = await getDefaultWatchlist();
  return Boolean(await db.watchlistItem.findUnique({ where: { watchlistId_securityId: { watchlistId: wl.id, securityId } } }));
}

export async function addToWatchlist(securityId: string, data: { notes?: string | null } = {}) {
  const wl = await getDefaultWatchlist();
  const item = await db.watchlistItem.upsert({
    where: { watchlistId_securityId: { watchlistId: wl.id, securityId } },
    create: { watchlistId: wl.id, securityId, notes: data.notes ?? null },
    update: {},
  });
  await ensureDefaultAlerts(securityId);
  return item;
}

export async function updateWatchlistItem(itemId: string, data: { targetPrice: number | null; marginOfSafetyTarget: number | null; notes: string | null }) {
  const item = await db.watchlistItem.findUniqueOrThrow({ where: { id: itemId }, include: { security: { include: { exchange: true } } } });
  const currency = item.security.exchange.currency === "ILA" ? "ILS" : item.security.exchange.currency;
  const updated = await db.watchlistItem.update({
    where: { id: itemId },
    data: { targetPrice: data.targetPrice, targetCurrency: data.targetPrice === null ? null : currency, marginOfSafetyTarget: data.marginOfSafetyTarget, notes: data.notes },
  });
  await syncWatchlistTargets(item.securityId, { targetPrice: data.targetPrice, targetCurrency: currency, marginOfSafetyTarget: data.marginOfSafetyTarget });
  return updated;
}

export interface WatchlistRow {
  itemId: string;
  securityId: string;
  ticker: string;
  name: string;
  nameHe: string | null;
  exchangeCode: string;
  isDevFixture: boolean;
  notes: string | null;
  addedAt: string;
  price: { value: number | null; currency: string; timestamp: string | null; status: QuoteStatus; manual: boolean };
  strategy: Strategy;
  qualification: { outcome: ScreenOutcome; passed: number; applicable: number } | null;
  isEtf: boolean;
  target: { price: number | null; currency: string | null; distance: number | null };
  ceiling: number | null;
  ceilingCurrency: string | null;
  marginOfSafety: number | null;
  marginOfSafetyTarget: number | null;
  category: DecisionCategory;
  lastAnalysisAt: string | null;
  freshness: { quote: QuoteStatus; fundamentals: DataStatus };
}

/** Watchlist rows with the latest stored price, Graham qualification, targets and freshness. Reads stored data only. */
export async function getWatchlistDashboard(): Promise<{ rows: WatchlistRow[]; defaultMarginOfSafetyTarget: number }> {
  const { getSecurityAnalysis } = await import("./analysis");
  const wl = await getDefaultWatchlist();
  const items = await db.watchlistItem.findMany({ where: { watchlistId: wl.id }, orderBy: { addedAt: "desc" } });
  const rows: WatchlistRow[] = [];
  let defaultMos = 0.3;
  for (const it of items) {
    const quote = await getQuoteView(it.securityId, { noFetch: true });
    const a = await getSecurityAnalysis(it.securityId, { quote });
    if (!a) continue;
    defaultMos = a.settings.valuation.marginOfSafetyTarget;
    const last = await db.analysisSnapshot.findFirst({ where: { securityId: it.securityId }, orderBy: { computedAt: "desc" }, select: { computedAt: true } });
    const screen = a.decision.strategy === "DEFENSIVE" ? a.graham.defensive : a.decision.strategy === "ENTERPRISING" ? a.graham.enterprising : a.graham.netNet.screen;
    const counted = screen.rules.filter((r) => r.counted);
    const targetPrice = it.targetPrice === null ? null : Number(it.targetPrice);
    rows.push({
      itemId: it.id,
      securityId: it.securityId,
      ticker: a.security.ticker,
      name: a.security.name,
      nameHe: a.security.nameHe,
      exchangeCode: a.security.exchangeCode,
      isDevFixture: a.freshness.usesDevFixtureData,
      notes: it.notes,
      addedAt: it.addedAt.toISOString(),
      price: { value: quote.price, currency: quote.currency, timestamp: quote.sourceTimestamp, status: quote.status, manual: quote.manual !== null },
      strategy: a.decision.strategy,
      qualification: { outcome: screen.outcome, passed: counted.filter((r) => r.status === "PASS").length, applicable: counted.filter((r) => r.status !== "NOT_APPLICABLE").length },
      isEtf: a.graham.classification.industryClass === "ETF",
      target: {
        price: targetPrice,
        currency: it.targetCurrency,
        // How far the price must fall to reach the target (negative = already below it).
        distance: targetPrice !== null && quote.price !== null && it.targetCurrency === quote.currency ? quote.price / targetPrice - 1 : null,
      },
      ceiling: a.decision.keyFigures.ceiling,
      ceilingCurrency: a.decision.keyFigures.currency,
      marginOfSafety: a.decision.keyFigures.marginOfSafetyPercent === null ? null : a.decision.keyFigures.marginOfSafetyPercent / 100,
      marginOfSafetyTarget: it.marginOfSafetyTarget,
      category: a.decision.category,
      lastAnalysisAt: last?.computedAt.toISOString() ?? null,
      freshness: { quote: quote.status, fundamentals: a.health.fundamentalsStatus.status },
    });
  }
  return { rows, defaultMarginOfSafetyTarget: defaultMos };
}
