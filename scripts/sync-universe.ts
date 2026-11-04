/**
 * Sync the US security master (ticker, name, CIK, exchange) from SEC EDGAR.
 * Requires SEC_USER_AGENT. Usage: npm run data:sync-universe
 */
import { syncUniverse } from "@/server/ingestion";
import { db } from "@/server/db";

syncUniverse()
  .then((r) => console.log(`Synced ${r.upserted} securities from SEC EDGAR.`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
