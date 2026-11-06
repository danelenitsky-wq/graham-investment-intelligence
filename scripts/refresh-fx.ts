/** Fetch the Bank of Israel USD/ILS representative rate (last 14 days). Usage: npm run fx:refresh */
import { refreshBoiRates } from "@/server/fx";
import { db } from "@/server/db";

refreshBoiRates()
  .then((r) => {
    console.log(`Bank of Israel USD/ILS: ${r.status}, ${r.stored} observation(s), latest ${r.latest ?? "—"} ${r.error ?? ""}`);
    if (r.status !== "SUCCESS") process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
