/**
 * Evaluate every alert rule of every followed security (portfolio + watchlist).
 * Usage: npm run alerts:check                 (refresh quotes/filings within free-plan budgets, then evaluate)
 *        npm run alerts:check -- --no-fetch   (stored data only)
 *        npm run alerts:check -- --fx         (also fetch the Bank of Israel USD/ILS rate first)
 * Runs from this script are recorded as SCRIPT runs. Background monitoring is
 * only reported as active for SCHEDULED runs (GET /api/cron/check-alerts).
 */
import { runAlertChecks } from "@/server/alerts";
import { refreshBoiRates } from "@/server/fx";
import { db } from "@/server/db";

async function main() {
  if (process.argv.includes("--fx")) {
    const fx = await refreshBoiRates();
    console.log(`FX (Bank of Israel): ${fx.status}, ${fx.stored} observation(s), latest ${fx.latest ?? "—"} ${fx.error ?? ""}`);
  }
  const s = await runAlertChecks({ trigger: "SCRIPT", fetch: !process.argv.includes("--no-fetch") });
  console.log(`checked ${s.checked} · new alerts ${s.newEvents} · duplicates prevented ${s.duplicates} · provider calls ${s.providerCalls} · rules skipped ${s.skipped}`);
  for (const e of s.errors) console.log(`  ${e.ticker}: ${e.error}`);
  const events = await db.alertEvent.findMany({ where: { runId: s.runId }, orderBy: { triggeredAt: "asc" } });
  for (const e of events) console.log(`  [${e.severity}] ${e.type} ${JSON.stringify(e.params)}`);
  if (s.errors.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
