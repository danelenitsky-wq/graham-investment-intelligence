import "server-only";
import { providerStatuses } from "@/lib/providers/registry";
import { db } from "./db";

export async function getDataHealth() {
  const [sources, recentFetches, openIssues, counts, fixtureSecurities] = await Promise.all([
    db.dataSource.findMany({
      orderBy: { key: "asc" },
      include: { fetches: { orderBy: { startedAt: "desc" }, take: 1 } },
    }),
    db.dataFetch.findMany({ orderBy: { startedAt: "desc" }, take: 25, include: { source: true, security: { include: { exchange: true } } } }),
    db.dataQualityIssue.findMany({
      where: { resolvedAt: null },
      orderBy: [{ severity: "desc" }, { detectedAt: "desc" }],
      take: 50,
      include: { security: { include: { exchange: true } } },
    }),
    Promise.all([db.security.count(), db.priceBar.count(), db.financialStatement.count(), db.analysisSnapshot.count()]),
    db.security.count({ where: { source: { isDevFixture: true } } }),
  ]);
  const failures24h = await db.dataFetch.count({ where: { status: "FAILED", startedAt: { gte: new Date(Date.now() - 86_400_000) } } });
  return {
    providers: providerStatuses(),
    sources,
    recentFetches,
    openIssues,
    counts: { securities: counts[0], priceBars: counts[1], statements: counts[2], snapshots: counts[3] },
    fixtureSecurities,
    failures24h,
  };
}
