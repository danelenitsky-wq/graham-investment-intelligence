/**
 * Fetch the Bank of Israel USD/ILS representative rate (last 14 days), then the
 * rates of the purchase dates of foreign-currency holdings that have none
 * stored (used for the historical cost basis). Usage: npm run fx:refresh
 */
import { refreshBoiRates } from "@/server/fx";
import { backfillPortfolioFxRates } from "@/server/portfolio";
import { db } from "@/server/db";

async function main() {
  const r = await refreshBoiRates();
  console.log(`Bank of Israel USD/ILS: ${r.status}, ${r.stored} observation(s), latest ${r.latest ?? "—"} ${r.error ?? ""}`);
  if (r.status !== "SUCCESS") process.exitCode = 1;
  const b = await backfillPortfolioFxRates();
  console.log(`Purchase-date rates: ${b.requested} date(s) fetched, ${b.stored} observation(s) stored, ${b.failed.length} failed`);
  for (const f of b.failed) console.log(`  ${f.date}: ${f.error}`);
  if (b.failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
