/**
 * Portfolio import, manual prices, FX, watchlist targets and alert runs
 * against a real PostgreSQL (synthetic securities, no network).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RawHoldingRow } from "@/lib/portfolio/import/validate";

const { db } = await import("@/server/db");
const { previewImport, commitImport, ImportError } = await import("@/server/portfolio-import");
const { recordManualPrice, ManualPriceError } = await import("@/server/manual-prices");
const { addManualFxRate, listFxRates, deleteFxRate } = await import("@/server/fx");
const { addToWatchlist, updateWatchlistItem, getDefaultWatchlist, getWatchlistDashboard } = await import("@/server/watchlist");
const { runAlertChecks } = await import("@/server/alerts");
const { getDefaultPortfolio, getPortfolioDashboard } = await import("@/server/portfolio");

const US = "ZZHUS";
const IL = "ZZHIL";
const ETF = "ZZHEF";
let usId = "";
const fxIds: string[] = [];

const row = (line: number, fields: RawHoldingRow["fields"]): RawHoldingRow => ({ line, fields });
const usRow = row(2, { ticker: US, exchange: "NYSE", securityType: "STOCK", quantity: "10", averagePrice: "50", currency: "USD", purchaseDate: "2025-01-02" });
const ilRow = row(3, { ticker: IL, exchange: "TASE", securityType: "STOCK", quantity: "100", averagePrice: "5230", currency: "ILS", priceUnit: "agorot", name: "Synthetic Israeli" });
const etfRow = row(4, { ticker: ETF, exchange: "NYSEARCA", securityType: "ETF", quantity: "5", averagePrice: "400", currency: "USD" });

async function cleanup() {
  const secs = await db.security.findMany({ where: { ticker: { in: [US, IL, ETF] } }, select: { id: true } });
  const ids = secs.map((s) => s.id);
  await db.alertEvent.deleteMany({ where: { securityId: { in: ids } } });
  await db.alert.deleteMany({ where: { securityId: { in: ids } } });
  await db.watchlistItem.deleteMany({ where: { securityId: { in: ids } } });
  await db.portfolioTransaction.deleteMany({ where: { securityId: { in: ids } } });
  await db.position.deleteMany({ where: { securityId: { in: ids } } });
  await db.quoteSnapshot.deleteMany({ where: { securityId: { in: ids } } });
  await db.analysisSnapshot.deleteMany({ where: { securityId: { in: ids } } });
  await db.security.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  const ex = [
    { code: "NYSE", mic: "XNYS", name: "New York Stock Exchange", market: "US" as const, country: "US", currency: "USD", timezone: "America/New_York" },
    { code: "NYSEARCA", mic: "ARCX", name: "NYSE Arca", market: "US" as const, country: "US", currency: "USD", timezone: "America/New_York" },
    { code: "TASE", mic: "XTAE", name: "Tel Aviv Stock Exchange", market: "IL" as const, country: "IL", currency: "ILS", timezone: "Asia/Jerusalem" },
  ];
  for (const e of ex) await db.exchange.upsert({ where: { code: e.code }, create: e, update: {} });
  await cleanup();
  const nyse = await db.exchange.findUniqueOrThrow({ where: { code: "NYSE" } });
  usId = (await db.security.create({ data: { ticker: US, name: "Synthetic US company", exchangeId: nyse.id } })).id;
});

afterAll(async () => {
  await cleanup();
  for (const id of fxIds) await deleteFxRate(id).catch(() => undefined);
  await db.$disconnect();
});

describe("portfolio import", () => {
  it("previews without saving and blocks unknown US symbols", async () => {
    const bad = row(5, { ticker: "ZZHNO", exchange: "NASDAQ", securityType: "STOCK", quantity: "1", averagePrice: "1", currency: "USD" });
    const p = await previewImport([usRow, ilRow, bad], { kind: "CSV", fileName: "t.csv" });
    expect(p.canCommit).toBe(false);
    expect(p.rows.find((r) => r.line === 5)!.issues.map((i) => i.code)).toContain("SECURITY_NOT_FOUND");
    expect(p.holdings.find((h) => h.ticker === IL)).toMatchObject({ resolution: "CREATE_USER_ENTERED", averagePrice: 52.3, currency: "ILS" });
    expect(await db.security.count({ where: { ticker: IL } })).toBe(0);
    await expect(commitImport([usRow, ilRow, bad], { kind: "CSV", expectedHash: p.contentHash })).rejects.toMatchObject({ code: "HAS_ERRORS" });
  });

  it("requires the confirmed preview and saves positions in their own currency", async () => {
    const rows = [usRow, ilRow, etfRow];
    const p = await previewImport(rows, { kind: "CSV" });
    expect(p.canCommit).toBe(true);
    await expect(commitImport(rows, { kind: "CSV", expectedHash: "stale" })).rejects.toBeInstanceOf(ImportError);
    await commitImport(rows, { kind: "CSV", fileName: "t.csv", expectedHash: p.contentHash });
    const portfolio = await getDefaultPortfolio();
    const positions = await db.position.findMany({ where: { portfolioId: portfolio.id, security: { ticker: { in: [US, IL, ETF] } } }, include: { security: true } });
    const by = Object.fromEntries(positions.map((x) => [x.security.ticker, x]));
    expect(Number(by[IL].averageCost)).toBe(52.3);
    expect(by[IL]).toMatchObject({ currency: "ILS", costInputUnit: "ILA" });
    expect(by[ETF].security.assetType).toBe("ETF");
    expect(by[US].currency).toBe("USD");
    expect(await db.alert.count({ where: { securityId: usId } })).toBeGreaterThan(0);
  });

  it("merges a second import into the existing position with a weighted average", async () => {
    const again = [row(2, { ...usRow.fields, quantity: "30", averagePrice: "70" })];
    const p = await previewImport(again, { kind: "CSV" });
    expect(p.holdings[0]).toMatchObject({ existingPosition: { quantity: 10 }, after: { quantity: 40, averageCost: 65 } });
    await commitImport(again, { kind: "CSV", expectedHash: p.contentHash });
    const pos = await db.position.findFirstOrThrow({ where: { securityId: usId } });
    expect(Number(pos.quantity)).toBe(40);
    expect(Number(pos.averageCost)).toBe(65);
  });
});

describe("manual prices and FX", () => {
  it("stores TASE prices in shekels with the entered unit, timestamp and source", async () => {
    const il = await db.security.findFirstOrThrow({ where: { ticker: IL } });
    const ts = new Date(Date.now() - 3_600_000);
    const q = await recordManualPrice({ securityId: il.id, price: 6000, unit: "ILA", timestamp: ts, sourceLabel: "TASE website close" });
    expect(Number(q.price)).toBe(60);
    expect(q).toMatchObject({ currency: "ILS", isManual: true, enteredUnit: "ILA", sourceLabel: "TASE website close" });
    await expect(recordManualPrice({ securityId: il.id, price: 60, unit: "USD", timestamp: ts, sourceLabel: "x" })).rejects.toBeInstanceOf(ManualPriceError);
    await expect(recordManualPrice({ securityId: il.id, price: 60, unit: "ILS", timestamp: new Date(Date.now() + 86_400_000), sourceLabel: "x" })).rejects.toMatchObject({ code: "FUTURE_TIMESTAMP" });
  });

  it("shows separate currency totals until a sourced rate exists, then consolidates", async () => {
    // Other rows in the test database may hold rates; only assert when none is usable.
    const before = await getPortfolioDashboard();
    const ilRowView = before.rows.find((r) => r.ticker === IL)!;
    expect(ilRowView).toMatchObject({ currency: "ILS", marketValue: 6000, unrealizedPnl: 6000 - 5230 });
    expect(ilRowView.quote.manual).toMatchObject({ sourceLabel: "TASE website close" });
    expect(ilRowView.screens.defensive.outcome).toBeDefined();
    expect(before.rows.find((r) => r.ticker === ETF)?.isEtf).toBe(true);
    if (before.summary.consolidated === null) expect(before.summary.consolidationBlocked.map((b) => b.from)).toContain("ILS");

    const today = new Date().toISOString().slice(0, 10);
    const rate = await addManualFxRate({ base: "USD", quote: "ILS", rate: 3.2, date: today, sourceLabel: "Integration test" });
    fxIds.push(rate.id);
    expect((await listFxRates()).some((r) => r.id === rate.id && r.kind === "MANUAL")).toBe(true);
    const after = await getPortfolioDashboard();
    expect(after.summary.consolidated).not.toBeNull();
    expect(after.rows.find((r) => r.ticker === IL)?.weight).not.toBeNull();
  });
});

describe("watchlist and alerts", () => {
  it("keeps the watchlist target in sync with its alert rule", async () => {
    const il = await db.security.findFirstOrThrow({ where: { ticker: IL } });
    const item = await addToWatchlist(il.id);
    await updateWatchlistItem(item.id, { targetPrice: 65, marginOfSafetyTarget: 0.3, notes: "wait for 65" });
    const rule = await db.alert.findUniqueOrThrow({ where: { securityId_type: { securityId: il.id, type: "CUSTOM_TARGET_PRICE" } } });
    expect(Number(rule.threshold)).toBe(65);
    expect(rule.params).toMatchObject({ currency: "ILS", direction: "AT_OR_BELOW" });
    const wl = await getWatchlistDashboard();
    expect(wl.rows.find((r) => r.ticker === IL)).toMatchObject({ target: { price: 65, currency: "ILS" }, marginOfSafetyTarget: 0.3 });
    expect(wl.rows.find((r) => r.ticker === IL)!.target.distance).toBeCloseTo(60 / 65 - 1, 9);
    await updateWatchlistItem(item.id, { targetPrice: null, marginOfSafetyTarget: null, notes: null });
    expect((await db.alert.findUniqueOrThrow({ where: { securityId_type: { securityId: il.id, type: "CUSTOM_TARGET_PRICE" } } })).status).toBe("DISABLED");
    await updateWatchlistItem(item.id, { targetPrice: 65, marginOfSafetyTarget: null, notes: null });
    expect((await getDefaultWatchlist()).id).toBe(item.watchlistId);
  });

  it("records each occurrence once across repeated runs", async () => {
    const il = await db.security.findFirstOrThrow({ where: { ticker: IL } });
    const first = await runAlertChecks({ trigger: "SCRIPT" });
    expect(first.errors.filter((e) => [US, IL, ETF].includes(e.ticker))).toEqual([]);
    const target = await db.alertEvent.findMany({ where: { securityId: il.id, type: "CUSTOM_TARGET_PRICE" } });
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({ message: "customTargetBelow", params: { price: 60, target: 65, currency: "ILS" } });
    // The US company has no price at all: one stale-data warning.
    expect(await db.alertEvent.count({ where: { securityId: usId, type: "DATA_STALE" } })).toBe(1);
    const count = await db.alertEvent.count({ where: { securityId: { in: [usId, il.id] } } });

    const second = await runAlertChecks({ trigger: "SCRIPT" });
    expect(await db.alertEvent.count({ where: { securityId: { in: [usId, il.id] } } })).toBe(count);
    expect(second.runId).not.toBe(first.runId);
    const run = await db.alertRun.findUniqueOrThrow({ where: { id: second.runId } });
    expect(run.completedAt).not.toBeNull();

    // Losing the rule state cannot duplicate an occurrence: the dedupe key is unique.
    await db.alert.updateMany({ where: { securityId: il.id }, data: { state: null as never } });
    const third = await runAlertChecks({ trigger: "SCRIPT" });
    expect(await db.alertEvent.count({ where: { securityId: il.id, type: "CUSTOM_TARGET_PRICE" } })).toBe(1);
    expect(third.duplicates).toBeGreaterThan(0);
  });
});
