/**
 * Refresh prices + fundamentals for one or more securities.
 * Usage: npm run data:refresh -- AAPL NASDAQ:MSFT NYSE:KO
 */
import { refreshSecurity } from "@/server/ingestion";
import { db } from "@/server/db";

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) throw new Error("Usage: npm run data:refresh -- TICKER [EXCHANGE:TICKER ...]");
  for (const arg of args) {
    const [a, b] = arg.toUpperCase().split(":");
    const [exchange, ticker] = b ? [a, b] : [undefined, a];
    const security = await db.security.findFirst({ where: { ticker, ...(exchange ? { exchange: { code: exchange } } : {}) }, include: { exchange: true } });
    if (!security) {
      console.error(`${arg}: not in the security master (run data:sync-universe first)`);
      process.exitCode = 1;
      continue;
    }
    const r = await refreshSecurity(security.id);
    console.log(`${security.exchange.code}:${security.ticker}`, JSON.stringify(r));
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
