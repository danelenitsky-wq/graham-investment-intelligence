/**
 * Graham engine on real companies, end to end through the free providers and
 * PostgreSQL. Must run on a machine with network access (the cloud build
 * environment blocks the provider hosts).
 *
 *   npm run graham:real                                  # MSFT NVDA GOOGL KO JNJ JPM O
 *   npm run graham:real -- AAPL KO --out graham-real.json
 *   npm run graham:real -- --no-refresh                  # use stored data only
 *
 * For every security: refresh (issuer profile, prices, dividends, statements),
 * then run the engine and print each rule's status with the deciding values.
 * A security whose data cannot be fetched is BLOCKED; nothing is invented.
 * Secrets are never printed: all configured key values are masked.
 */
import { writeFileSync } from "node:fs";
import { getSecurityAnalysis } from "@/server/analysis";
import { db } from "@/server/db";
import { refreshSecurity } from "@/server/ingestion";
import type { RuleResult } from "@/lib/graham/types";

const DEFAULT = ["MSFT", "NVDA", "GOOGL", "KO", "JNJ", "JPM", "O"];
const secrets = [process.env.TIINGO_API_KEY, process.env.FINNHUB_API_KEY, process.env.TWELVE_DATA_API_KEY, process.env.FMP_API_KEY, process.env.CRON_SECRET, process.env.DATABASE_URL].filter(
  (s): s is string => Boolean(s && s.length >= 6),
);
const mask = (t: string) => secrets.reduce((x, s) => x.split(s).join("***"), t);
const out = (line: string) => console.log(mask(line));

function fmtNum(v: number | null): string {
  if (v === null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return Number.isInteger(v) ? String(v) : v.toFixed(a < 10 ? 3 : 2);
}

function ruleLine(r: RuleResult): string {
  const checks = r.checks.map((c) => `${c.key}=${fmtNum(c.actual)} ${c.op} ${fmtNum(c.threshold)}`).join("; ");
  const flags = [r.verification === "UNVERIFIED" ? "UNVERIFIED" : "", r.counted ? "" : "advisory"].filter(Boolean).join(",");
  return `    ${r.id.padEnd(5)} ${r.status.padEnd(18)} ${checks || "—"}  [${r.reason}${flags ? ` · ${flags}` : ""}] ${r.period ?? ""}`;
}

async function main() {
  const args = process.argv.slice(2);
  const noRefresh = args.includes("--no-refresh");
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
  const tickers = args.filter((a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1));
  const list = tickers.length ? tickers : DEFAULT;
  const report: Record<string, unknown>[] = [];

  for (const arg of list) {
    const [a, b] = arg.toUpperCase().split(":");
    const [exchange, ticker] = b ? [a, b] : [undefined, a];
    const security = await db.security.findFirst({ where: { ticker, ...(exchange ? { exchange: { code: exchange } } : {}) }, include: { exchange: true } });
    if (!security) {
      out(`\n${arg}: BLOCKED — not in the security master (run npm run data:sync-universe first)`);
      report.push({ ticker: arg, result: "BLOCKED", detail: "not in security master" });
      continue;
    }
    out(`\n${security.exchange.code}:${security.ticker}  ${security.name}`);
    let refresh: unknown = "skipped";
    if (!noRefresh) {
      try {
        refresh = await refreshSecurity(security.id);
      } catch (e) {
        refresh = { error: e instanceof Error ? e.message : String(e) };
      }
      out(`  refresh: ${JSON.stringify(refresh).slice(0, 400)}`);
    }
    const an = await getSecurityAnalysis(security.id);
    if (!an || an.annual.length === 0) {
      out("  BLOCKED — no annual statements stored (provider unreachable or not configured)");
      report.push({ ticker: security.ticker, result: "BLOCKED", detail: "no statements", refresh });
      continue;
    }
    const g = an.graham;
    const years = an.annual.map((x) => x.fiscalYear);
    out(`  issuer: ${g.classification.industryClass} (${g.classification.basis}${g.classification.sicCode ? ` ${g.classification.sicCode}` : ""}) · FY${years[0]}–FY${years[years.length - 1]} (${years.length} years) · price ${an.price ? `${an.price.value} ${an.price.currency} ${an.price.date} [${an.price.status}]` : "—"}`);
    out(`  dividends stored: ${an.dividends.length ? `${an.dividends[0].exDate} → ${an.dividends[an.dividends.length - 1].exDate}` : "none"} · excluded distributions: ${g.excludedDistributions.map((x) => `${x.exDate} ${x.amount}`).join(", ") || "none"}`);
    for (const s of [g.defensive, g.enterprising, g.netNet.screen]) {
      out(`  ${s.screen}: ${s.outcome} (${s.ruleSet}) — pass ${s.passed}, fail ${s.failed}, insufficient ${s.insufficient}, n/a ${s.notApplicable}`);
      for (const r of s.rules) out(ruleLine(r));
    }
    for (const r of g.netNet.risks) out(`    risk ${r.id.padEnd(22)} ${r.level.padEnd(18)} ${r.reason}`);
    report.push({
      ticker: security.ticker,
      result: "TESTED",
      classification: g.classification,
      fiscalYears: years,
      price: an.price,
      gateSufficient: an.health.gate.sufficient,
      excludedDistributions: g.excludedDistributions,
      defensive: { outcome: g.defensive.outcome, rules: g.defensive.rules.map((r) => ({ id: r.id, status: r.status, reason: r.reason, checks: r.checks, period: r.period })) },
      enterprising: { outcome: g.enterprising.outcome, rules: g.enterprising.rules.map((r) => ({ id: r.id, status: r.status, reason: r.reason, checks: r.checks, period: r.period })) },
      netNet: { outcome: g.netNet.screen.outcome, ncav: g.netNet.ncav, ncavPerShare: g.netNet.ncavPerShare, threshold: g.netNet.purchaseThreshold, risks: g.netNet.risks.map((r) => ({ id: r.id, level: r.level, reason: r.reason })) },
    });
  }
  if (outFile) {
    writeFileSync(outFile, mask(JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)));
    out(`\nWrote ${outFile}`);
  }
}

main()
  .catch((e) => {
    console.error(mask(e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
