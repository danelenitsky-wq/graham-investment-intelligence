/**
 * Decision engine on real companies, end to end through the free providers and
 * PostgreSQL. Must run on a machine with network access (the cloud build
 * environment blocks the provider hosts).
 *
 *   npm run decision:real                                    # MSFT NVDA GOOGL KO JNJ JPM O
 *   npm run decision:real -- KO JNJ --strategy ENTERPRISING
 *   npm run decision:real -- --no-refresh --out-dir decision-reports
 *
 * For every security: refresh (prices, dividends, statements), run every
 * engine, print the classification with its ten factors, save a timestamped
 * decision snapshot (trigger SCRIPT) and write the research report as
 * Markdown (Hebrew and English) to --out-dir. A security whose data cannot be
 * fetched is BLOCKED; nothing is invented. Secrets are never printed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reportToMarkdown, STRATEGIES, type Strategy } from "@/lib/decision";
import { getSecurityAnalysis } from "@/server/analysis";
import { db } from "@/server/db";
import { persistDecisionSnapshot, researchReport } from "@/server/decision";
import { refreshSecurity } from "@/server/ingestion";

const DEFAULT = ["MSFT", "NVDA", "GOOGL", "KO", "JNJ", "JPM", "O"];
const secrets = [process.env.TIINGO_API_KEY, process.env.FINNHUB_API_KEY, process.env.TWELVE_DATA_API_KEY, process.env.FMP_API_KEY, process.env.CRON_SECRET, process.env.DATABASE_URL].filter(
  (s): s is string => Boolean(s && s.length >= 6),
);
const mask = (t: string) => secrets.reduce((x, s) => x.split(s).join("***"), t);
const out = (line: string) => console.log(mask(line));

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const noRefresh = args.includes("--no-refresh");
  const outDir = flag("--out-dir") ?? "decision-reports";
  const st = flag("--strategy");
  const strategy = st && STRATEGIES.includes(st as Strategy) ? (st as Strategy) : null;
  const valued = new Set(["--out-dir", "--strategy"].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  const tickers = args.filter((a, i) => !a.startsWith("--") && !valued.has(i));
  const list = tickers.length ? tickers : DEFAULT;
  mkdirSync(outDir, { recursive: true });
  const summary: Record<string, unknown>[] = [];

  for (const arg of list) {
    const [a, b] = arg.toUpperCase().split(":");
    const [exchange, ticker] = b ? [a, b] : [undefined, a];
    const security = await db.security.findFirst({ where: { ticker, ...(exchange ? { exchange: { code: exchange } } : {}) }, include: { exchange: true } });
    if (!security) {
      out(`\n${arg}: BLOCKED — not in the security master (run npm run data:sync-universe first)`);
      summary.push({ ticker: arg, result: "BLOCKED", detail: "not in security master" });
      continue;
    }
    out(`\n${security.exchange.code}:${security.ticker}  ${security.name}`);
    if (!noRefresh) {
      try {
        const r = await refreshSecurity(security.id);
        out(`  refresh: prices ${r.prices.status} · fundamentals ${r.fundamentals.status}`);
      } catch (e) {
        out(`  refresh failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const an = await getSecurityAnalysis(security.id, { strategy });
    if (!an || an.annual.length === 0) {
      out("  BLOCKED — no annual statements stored (provider unreachable or not configured)");
      summary.push({ ticker: security.ticker, result: "BLOCKED", detail: "no statements" });
      continue;
    }
    const d = an.decision;
    const k = d.keyFigures;
    out(`  price ${k.price ?? "—"} ${k.currency ?? ""} ${k.priceDate ?? ""} [${k.priceBasis}] · gate ${an.health.gate.sufficient ? "PASS" : `FAIL (missing ${an.health.gate.missing.join(",") || "—"}; stale ${an.health.gate.stale.join(",") || "—"}; conflicts ${an.health.gate.conflicting.join(",") || "—"})`}`);
    out(`  ⇒ ${d.category}${d.confidence ? ` (${d.confidence})` : ""} under ${d.strategy}${d.owned ? " · OWNED" : ""}`);
    out(`    ceiling ${k.ceiling?.toFixed(2) ?? "—"} · intrinsic ${k.intrinsicValue?.toFixed(2) ?? "not established"} · MoS ${k.marginOfSafetyPercent?.toFixed(1) ?? "—"}% · NCAV/sh ${k.ncavPerShare?.toFixed(2) ?? "—"}`);
    for (const f of d.factors) out(`    ${f.id.padEnd(18)} ${f.status.padEnd(14)} ${f.reason}`);
    for (const r of [...d.reasons, ...d.reviewTriggers]) out(`    → ${r.code}`);
    for (const c of d.caveats) out(`    ! ${c.code}`);
    const snap = await persistDecisionSnapshot(an, "SCRIPT");
    out(`  snapshot ${snap.saved ? "saved" : "unchanged"} (${snap.id}) hash ${snap.snapshot.inputsHash}`);
    for (const locale of ["he", "en"] as const) {
      const file = join(outDir, `${security.ticker}-${locale}.md`);
      writeFileSync(file, mask(reportToMarkdown(researchReport(an, locale))));
    }
    summary.push({
      ticker: security.ticker,
      result: "TESTED",
      category: d.category,
      confidence: d.confidence,
      strategy: d.strategy,
      gateSufficient: an.health.gate.sufficient,
      price: k.price,
      priceDate: k.priceDate,
      ceiling: k.ceiling,
      intrinsicValue: k.intrinsicValue,
      marginOfSafetyPercent: k.marginOfSafetyPercent,
      factors: Object.fromEntries(d.factors.map((f) => [f.id, `${f.status}:${f.reason}`])),
      reasons: d.reasons.map((r) => r.code),
      caveats: d.caveats.map((c) => c.code),
      snapshotId: snap.id,
    });
  }
  const file = join(outDir, "summary.json");
  writeFileSync(file, mask(JSON.stringify({ generatedAt: new Date().toISOString(), strategy: strategy ?? "settings default", summary }, null, 2)));
  out(`\nWrote ${outDir}/ (reports + summary.json)`);
}

main()
  .catch((e) => {
    console.error(mask(e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
