/**
 * Daily check for newly published 10-K / 10-Q filings (SEC EDGAR submissions).
 * Re-fetches statements and re-runs calculations only for securities with a new filing.
 * Usage: npm run data:check-filings            (all followed securities, respects the 24 h interval)
 *        npm run data:check-filings -- --force (ignore the interval)
 * Schedule it once a day (cron / systemd timer / CI) or call GET /api/cron/check-filings.
 */
import { checkAllFilings } from "@/server/filings";
import { db } from "@/server/db";

async function main() {
  const results = await checkAllFilings({ force: process.argv.includes("--force") });
  for (const r of results) console.log(r.ticker.padEnd(8), r.status.padEnd(11), r.latest ? `${r.latest.form} filed ${r.latest.filingDate} (${r.latest.accessionNumber})` : "", r.error ?? "");
  console.log(`${results.length} checked, ${results.filter((r) => r.status === "NEW_FILING").length} new filing(s), ${results.filter((r) => r.status === "FAILED").length} failed`);
  if (results.some((r) => r.status === "FAILED")) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
