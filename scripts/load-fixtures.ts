/**
 * Load the fictional development fixtures (ENABLE_DEV_FIXTURES=true required).
 * Usage: npm run db:seed:fixtures
 */
import { loadDevFixtures } from "@/server/ingestion";
import { db } from "@/server/db";

loadDevFixtures()
  .then((r) => console.log(`Loaded ${r.securities} fictional DEV FIXTURE securities.`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
