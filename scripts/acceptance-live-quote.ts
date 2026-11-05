/**
 * CRITICAL ACCEPTANCE TEST — live quote retrieval.
 *
 *   npm run acceptance:quote -- AAPL            (direct, through the server module)
 *   npm run acceptance:quote -- AAPL --url http://localhost:3000   (also through the HTTP API)
 *
 * 1. Queries a real ticker through the configured quote provider(s).
 * 2. Prints the provider's source timestamp (exchange-local and UTC) and our retrieval time.
 * 3. Presses "Refresh Now" (force) and proves a NEW provider request was made:
 *    a new DataFetch row with a later start time and a new fetch id.
 *
 * Without credentials it stops at the configuration checkpoint (exit code 2) and
 * never reports a live retrieval.
 */
import { db } from "@/server/db";
import { quoteProvidersFor, providerStatuses } from "@/lib/providers/registry";
import { ensureReferenceData } from "@/server/ingestion";
import { getQuoteView, type QuoteView } from "@/server/quotes";

const fmtLocal = (iso: string | null, tz: string) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "long" }).format(new Date(iso)) : "—";

function show(label: string, v: QuoteView) {
  console.log(`\n── ${label}`);
  console.log(`  status            ${v.status}${v.feedNote ? ` (${v.feedNote})` : ""}  [${v.reasons.join(", ")}]`);
  console.log(`  price             ${v.price ?? "—"} ${v.currency}   change ${v.change ?? "—"} (${v.changePercent !== null ? (v.changePercent * 100).toFixed(2) + "%" : "—"})`);
  console.log(`  provider          ${v.provider?.key ?? "—"}  feed=${v.feed ?? "—"}  served from ${v.servedFrom}  (cache decision: ${v.decision})`);
  console.log(`  source timestamp  ${fmtLocal(v.sourceTimestamp, v.timezone)}   [${v.sourceTimestamp ?? "—"} UTC]`);
  console.log(`  retrieved at      ${fmtLocal(v.retrievedAt, v.timezone)}   [${v.retrievedAt ?? "—"} UTC]`);
  console.log(`  market session    ${v.session.state}${v.session.closedReason ? ` (${v.session.closedReason}${v.session.holidayName ? `: ${v.session.holidayName}` : ""})` : ""}`);
  console.log(`  verification      ${v.verification.status}${v.verification.note ? ` — ${v.verification.note}` : ""}`);
  for (const a of v.attempts) console.log(`  request           ${a.provider} fetch=${a.fetchId} ${a.ok ? "OK" : "FAILED"} http=${a.httpStatus ?? "—"} ${a.error ?? ""}`);
}

async function main() {
  const args = process.argv.slice(2);
  const ticker = (args.find((a) => !a.startsWith("--")) ?? "AAPL").toUpperCase();
  const urlIdx = args.indexOf("--url");
  const baseUrl = urlIdx >= 0 ? args[urlIdx + 1] : null;

  const providers = quoteProvidersFor("US");
  if (providers.length === 0) {
    console.log("CONFIGURATION CHECKPOINT — no quote provider is configured, so live retrieval was NOT tested.");
    for (const p of providerStatuses().filter((s) => s.capabilities.includes("QUOTES")))
      console.log(`  ${p.name}: ${p.configured ? "configured" : `missing ${p.missingEnv.join(", ")}`}`);
    console.log("Set TIINGO_API_KEY (free) and optionally FINNHUB_API_KEY / TWELVE_DATA_API_KEY (free) in .env — see docs/DATA_PROVIDERS.md.");
    process.exitCode = 2;
    return;
  }

  await ensureReferenceData();
  const security = await db.security.findFirst({ where: { ticker, exchange: { market: "US" } }, include: { exchange: true } });
  if (!security) {
    console.log(`${ticker} is not in the security master. Run "npm run data:sync-universe" first (needs SEC_USER_AGENT).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Acceptance test: ${security.exchange.code}:${security.ticker} via ${providers.map((p) => p.descriptor.key).join(" → ")}`);

  const before = await db.dataFetch.count({ where: { securityId: security.id, dataset: "quote" } });
  const first = await getQuoteView(security.id);
  show("1) page open (cache policy)", first);
  await new Promise((r) => setTimeout(r, 3000));
  const second = baseUrl
    ? ((await (await fetch(`${baseUrl}/api/quote/${security.id}`, { method: "POST" })).json()) as QuoteView)
    : await getQuoteView(security.id, { force: true });
  show(`2) Refresh Now${baseUrl ? ` via POST ${baseUrl}/api/quote/${security.id}` : ""}`, second);
  const after = await db.dataFetch.count({ where: { securityId: security.id, dataset: "quote" } });

  const newRequest = second.attempts.length > 0 && second.attempts.every((a) => !first.attempts.some((b) => b.fetchId === a.fetchId)) && after > before;
  const gotQuote = second.servedFrom === "provider" && second.sourceTimestamp !== null;
  console.log(`\nquote requests recorded: ${before} → ${after}`);
  console.log(`Refresh Now made a new provider request: ${newRequest ? "YES" : "NO"}`);
  console.log(`Provider returned a quote with a source timestamp: ${gotQuote ? "YES" : "NO"}`);
  console.log(newRequest && gotQuote ? "\nACCEPTANCE: PASS" : "\nACCEPTANCE: FAIL");
  if (!(newRequest && gotQuote)) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
