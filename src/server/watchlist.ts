import "server-only";
import { db } from "./db";

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
