/**
 * Live validation of the free-first data providers.
 *
 *   npm run validate:free                      # MSFT NVDA GOOGL, provider level only
 *   npm run validate:free -- --db              # + end-to-end through PostgreSQL (refresh, Refresh Now, provenance)
 *   npm run validate:free -- AAPL KO --db --out validation.json
 *
 * Every check ends as PASS, FAIL, BLOCKED (credential or network missing, so
 * NOT tested) or SKIPPED (optional provider not configured). Nothing is ever
 * reported as PASS without a real provider response. Secrets are never
 * printed: endpoints are redacted and every configured key value is masked in
 * all output as a second safeguard.
 */
import { writeFileSync } from "node:fs";
import { calendarForExchange, localParts, previousTradingDay, sessionInfo, US_EQUITY_CALENDAR } from "@/lib/market/calendar";
import { REQUIRED_CONCEPTS } from "@/lib/freshness/gate";
import { finnhubQuotes } from "@/lib/providers/finnhub";
import { fmpStatements } from "@/lib/providers/fmp";
import { secEdgarFilings, secEdgarFundamentals, secEdgarReference } from "@/lib/providers/sec-edgar";
import { tiingoPrices, tiingoQuotes } from "@/lib/providers/tiingo";
import { twelveDataQuotes } from "@/lib/providers/twelve-data";
import { ProviderError, type NormalizedQuote, type SecurityRef } from "@/lib/providers/types";
import { quoteCloses, verifyQuote } from "@/lib/verification";
import { env } from "@/server/env";

type Result = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
interface Check {
  ticker: string;
  test: string;
  result: Result;
  detail: string;
  evidence?: Record<string, unknown>;
}

const secrets = [process.env.TIINGO_API_KEY, process.env.FINNHUB_API_KEY, process.env.TWELVE_DATA_API_KEY, process.env.FMP_API_KEY, process.env.CRON_SECRET].filter(
  (s): s is string => Boolean(s && s.length >= 6),
);
const mask = (text: string) => secrets.reduce((t, s) => t.split(s).join("***"), text);
const out = (line: string) => console.log(mask(line));

const checks: Check[] = [];
function record(c: Check) {
  checks.push(c);
  out(`  ${c.result.padEnd(7)} ${c.test.padEnd(34)} ${c.detail}`);
}

/** Network / credential failures are BLOCKED (not tested); anything else is a FAIL. */
function failure(ticker: string, test: string, e: unknown): Check {
  const err = e instanceof ProviderError ? e : null;
  const msg = e instanceof Error ? e.message : String(e);
  const blocked = err?.code === "NOT_CONFIGURED" || err?.code === "NETWORK_ERROR" || (err?.httpStatus === 403 && /proxy|tunnel/i.test(msg));
  return { ticker, test, result: blocked ? "BLOCKED" : "FAIL", detail: `${err?.code ?? "ERROR"}${err?.httpStatus ? ` http=${err.httpStatus}` : ""}: ${msg.slice(0, 160)}` };
}

const nyTime = (isoTs: string) => {
  const p = localParts(new Date(isoTs), "America/New_York");
  return `${p.date} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ET`;
};

function quoteEvidence(q: NormalizedQuote, endpoint: string) {
  return { price: q.price, previousClose: q.previousClose, sourceTimestamp: q.sourceTimestamp, sourceTimeET: nyTime(q.sourceTimestamp), feed: q.feed, yearHigh: q.yearHigh, yearLow: q.yearLow, endpoint };
}

async function validateTicker(ticker: string, cik: string | null, exchangeCode: string) {
  out(`\n${exchangeCode}:${ticker}  (CIK ${cik ?? "—"})`);
  const ref: SecurityRef = { ticker, exchangeCode, cik };
  const now = new Date();
  const today = localParts(now, US_EQUITY_CALENDAR.timezone).date;
  const session = sessionInfo(calendarForExchange(exchangeCode), now);

  // ── SEC EDGAR: statements ─────────────────────────────────────────────
  let latestAnnualAccession: string | null = null;
  try {
    const { result, quarterly, meta } = await secEdgarFundamentals.getAnnualFinancials(ref);
    const periods = result.periods;
    const last = periods.at(-1);
    const missing = last ? REQUIRED_CONCEPTS.filter((c) => !last.values[c]) : REQUIRED_CONCEPTS;
    const filed = last ? Object.values(last.values).reduce((m, v) => (v && v.filedAt > m.filedAt ? v : m), Object.values(last.values)[0]!) : null;
    latestAnnualAccession = filed?.accessionNumber ?? null;
    const years = periods.length;
    record({
      ticker,
      test: "SEC companyfacts (annual)",
      result: years >= 10 && missing.length === 0 ? "PASS" : years > 0 ? "FAIL" : "FAIL",
      detail: `${years} fiscal years FY${periods[0]?.fiscalYear ?? "?"}–FY${last?.fiscalYear ?? "?"}; latest period end ${last?.periodEnd ?? "—"} (${filed?.form ?? "—"} filed ${filed?.filedAt ?? "—"})${missing.length ? `; missing ${missing.join(", ")}` : ""}`,
      evidence: { endpoint: meta.endpoint, fiscalYears: periods.map((p) => p.fiscalYear), latestPeriodEnd: last?.periodEnd, latestFiledAt: filed?.filedAt, accession: filed?.accessionNumber, retrievedAt: meta.fetchedAt },
    });
    const lastQ = quarterly?.periods.at(-1);
    record({
      ticker,
      test: "SEC companyfacts (quarterly)",
      result: (quarterly?.periods.length ?? 0) >= 8 ? "PASS" : "FAIL",
      detail: `${quarterly?.periods.length ?? 0} quarters; latest ${lastQ ? `FY${lastQ.fiscalYear} ${lastQ.fiscalPeriod} ending ${lastQ.periodEnd}` : "—"}`,
      evidence: { latestQuarter: lastQ ? { fiscalYear: lastQ.fiscalYear, fiscalPeriod: lastQ.fiscalPeriod, periodEnd: lastQ.periodEnd } : null },
    });
    const dps = periods.filter((p) => p.values.dividendsPerShare).length;
    const metrics = ["revenue", "netIncome", "epsDiluted", "currentAssets", "currentLiabilities", "longTermDebt", "totalLiabilities", "stockholdersEquity", "sharesOutstanding", "operatingCashFlow", "dividendsPerShare"] as const;
    const coverage = Object.fromEntries(metrics.map((m) => [m, periods.filter((p) => p.values[m]).length]));
    record({
      ticker,
      test: "SEC metric coverage (years)",
      result: "PASS",
      detail: Object.entries(coverage).map(([k, v]) => `${k}=${v}`).join(" "),
      evidence: { coverage, dividendsPerShareYears: dps, latestValues: last ? Object.fromEntries(metrics.map((m) => [m, last.values[m] ? { value: last.values[m]!.value, unit: last.values[m]!.unit, concept: last.values[m]!.sourceConcept } : null])) : null },
    });
  } catch (e) {
    record(failure(ticker, "SEC companyfacts", e));
  }

  // ── SEC EDGAR: filings index ──────────────────────────────────────────
  try {
    const { filings, meta } = await secEdgarFilings.latestPeriodicFilings(ref);
    const latest = filings[0];
    const latestK = filings.find((f) => f.form === "10-K");
    const ageDays = latest?.reportDate ? (Date.parse(today) - Date.parse(latest.reportDate)) / 86_400_000 : null;
    record({
      ticker,
      test: "SEC submissions (latest filing)",
      // A 10-Q/10-K normally covers a period that ended < ~135 days ago.
      result: latest && ageDays !== null && ageDays < 200 ? "PASS" : "FAIL",
      detail: latest ? `${latest.form} for period ${latest.reportDate} filed ${latest.filingDate} (accepted ${latest.acceptedAt ?? "—"}); latest 10-K ${latestK?.filingDate ?? "—"}` : "no periodic filings",
      evidence: { endpoint: meta.endpoint, latest, latest10K: latestK, storedAnnualAccessionMatchesA10K: latestAnnualAccession ? filings.some((f) => f.accessionNumber === latestAnnualAccession) : null },
    });
  } catch (e) {
    record(failure(ticker, "SEC submissions", e));
  }

  // ── Tiingo: daily history, dividends, splits ──────────────────────────
  let bars: { date: string; close: number; high: number | null; low: number | null }[] = [];
  try {
    const start = `${now.getUTCFullYear() - 21}-01-01`;
    const h = await tiingoPrices.getDailyHistory(ref, { start, end: today });
    bars = h.bars.map((b) => ({ date: b.date, close: b.close, high: b.high, low: b.low }));
    const last = h.bars.at(-1);
    const expected = previousTradingDay(US_EQUITY_CALENDAR, today);
    const years = h.bars.length ? (Date.parse(last!.date) - Date.parse(h.bars[0].date)) / (365.25 * 86_400_000) : 0;
    record({
      ticker,
      test: "Tiingo daily history",
      result: last && last.date >= expected && years >= 19.5 ? "PASS" : "FAIL",
      detail: `${h.bars.length} bars ${h.bars[0]?.date ?? "—"} → ${last?.date ?? "—"} (${years.toFixed(1)} y); last close ${last?.close ?? "—"}; expected latest session ≥ ${expected}; ${h.rejected.length} rejected`,
      evidence: { endpoint: h.meta.endpoint, first: h.bars[0]?.date, last: last?.date, lastClose: last?.close, retrievedAt: h.meta.fetchedAt },
    });
    const divYears = new Set(h.dividends.map((d) => d.exDate.slice(0, 4)));
    record({
      ticker,
      test: "Tiingo dividends + splits",
      result: "PASS",
      detail: `${h.dividends.length} dividends in ${divYears.size} calendar years (${h.dividends[0]?.exDate ?? "none"} → ${h.dividends.at(-1)?.exDate ?? "—"}); splits: ${h.splits.map((s) => `${s.exDate}×${s.ratio}`).join(", ") || "none"}`,
      evidence: { dividends: h.dividends.length, firstDividend: h.dividends[0], lastDividend: h.dividends.at(-1), splits: h.splits },
    });
    const yearBars = h.bars.filter((b) => b.date > `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`);
    const hi = Math.max(...yearBars.map((b) => b.high ?? b.close));
    const lo = Math.min(...yearBars.map((b) => b.low ?? b.close));
    record({
      ticker,
      test: "52-week high/low (derived)",
      result: yearBars.length >= 240 ? "PASS" : "FAIL",
      detail: `high ${hi.toFixed(2)} / low ${lo.toFixed(2)} from ${yearBars.length} official daily bars`,
      evidence: { yearHigh: hi, yearLow: lo, bars: yearBars.length },
    });
  } catch (e) {
    record(failure(ticker, "Tiingo daily history", e));
  }

  // ── Latest quote: every configured provider ───────────────────────────
  const quotes: { provider: string; quote: NormalizedQuote }[] = [];
  for (const [name, provider, envName] of [
    ["Tiingo quote (official close)", tiingoQuotes, "TIINGO_API_KEY"],
    ["Finnhub quote (free)", finnhubQuotes, "FINNHUB_API_KEY"],
    ["Twelve Data quote (free)", twelveDataQuotes, "TWELVE_DATA_API_KEY"],
  ] as const) {
    if (!process.env[envName]) {
      record({ ticker, test: name, result: "BLOCKED", detail: `${envName} not set — not tested` });
      continue;
    }
    try {
      const { quote, meta } = await provider.getQuote(ref);
      quotes.push({ provider: provider.descriptor.key, quote });
      const ageMin = (now.getTime() - Date.parse(quote.sourceTimestamp)) / 60_000;
      const sane = quote.price > 0 && ageMin > -5 && (session.state === "OPEN" ? ageMin < (quote.feed === "EOD" ? 4 * 1440 : 60) : ageMin < 4 * 1440);
      record({
        ticker,
        test: name,
        result: sane ? "PASS" : "FAIL",
        detail: `${quote.price} @ ${nyTime(quote.sourceTimestamp)} (${Math.round(ageMin)} min old) feed=${quote.feed}${quote.yearHigh ? ` 52w ${quote.yearLow}–${quote.yearHigh}` : ""}`,
        evidence: quoteEvidence(quote, meta.endpoint),
      });
    } catch (e) {
      record(failure(ticker, name, e));
    }
  }

  // ── Cross-check: each quote's official closes against Tiingo daily bars ──
  const barByDate = new Map(bars.map((b) => [b.date, b.close]));
  for (const { provider, quote } of quotes.filter((q) => q.provider !== "tiingo")) {
    const closes = quoteCloses(quote, US_EQUITY_CALENDAR);
    const match = closes.find((c) => barByDate.has(c.date));
    if (!match) {
      record({ ticker, test: `Cross-check ${provider} vs Tiingo`, result: "FAIL", detail: `no common trading date (quote vouches for ${closes.map((c) => c.date).join(", ") || "none"})` });
      continue;
    }
    const v = verifyQuote({ provider, ...quote, closes }, { provider: "tiingo", price: barByDate.get(match.date)!, sourceTimestamp: match.date + "T21:00:00Z", closes: [{ date: match.date, value: barByDate.get(match.date)! }] });
    record({
      ticker,
      test: `Cross-check ${provider} vs Tiingo`,
      result: v.status === "VERIFIED" ? "PASS" : "FAIL",
      detail: `${v.comparedField}: ${v.primary} vs ${v.secondary} (Δ ${((v.relDiff ?? 0) * 100).toFixed(3)}%) → ${v.status}`,
    });
  }

  // ── FMP Basic (optional) ──────────────────────────────────────────────
  if (!process.env.FMP_API_KEY) {
    record({ ticker, test: "FMP Basic statements (optional)", result: "SKIPPED", detail: "FMP_API_KEY not set (optional supplementary source)" });
  } else {
    try {
      const { periods, meta } = await fmpStatements.getStatements(ref, "annual");
      record({ ticker, test: "FMP Basic statements (optional)", result: periods.length > 0 ? "PASS" : "FAIL", detail: `${periods.length} annual periods on the free plan`, evidence: { endpoint: meta.endpoint } });
    } catch (e) {
      const c = failure(ticker, "FMP Basic statements (optional)", e);
      if (e instanceof ProviderError && e.code === "NOT_ENTITLED") c.detail = `not available on the free plan (${e.message.slice(0, 120)}) — cross-check disabled, nothing else affected`;
      record(e instanceof ProviderError && e.code === "NOT_ENTITLED" ? { ...c, result: "SKIPPED" } : c);
    }
  }
}

async function validateEndToEnd(ticker: string) {
  const { db } = await import("@/server/db");
  const { refreshSecurity, syncUniverse } = await import("@/server/ingestion");
  const { getQuoteView } = await import("@/server/quotes");
  const { getMetricProvenance } = await import("@/server/provenance");
  out(`\n${ticker} — end to end (PostgreSQL)`);
  let security = await db.security.findFirst({ where: { ticker, exchange: { market: "US" } }, include: { exchange: true } });
  if (!security) {
    await syncUniverse();
    security = await db.security.findFirst({ where: { ticker, exchange: { market: "US" } }, include: { exchange: true } });
  }
  if (!security) return record({ ticker, test: "E2E security master", result: "FAIL", detail: "not found after universe sync" });

  const r = await refreshSecurity(security.id);
  record({
    ticker,
    test: "E2E refresh (prices + statements)",
    result: r.prices.status === "SUCCESS" && (r.fundamentals.status === "SUCCESS" || r.fundamentals.status === "UNCHANGED") ? "PASS" : "FAIL",
    detail: `prices ${r.prices.status} (${r.prices.count ?? 0}); statements ${r.fundamentals.status} (${r.fundamentals.periods ?? 0} y, ${r.fundamentals.quarters ?? 0} q); FMP cross-check ${r.verification?.status ?? "—"}${r.verification?.code ? ` ${r.verification.code}` : ""}; dividends verified ${r.dividends?.verifiedYears ?? 0}/${r.dividends?.comparedYears ?? 0} FY`,
    evidence: r as unknown as Record<string, unknown>,
  });

  const before = await db.dataFetch.count({ where: { securityId: security.id, dataset: "quote" } });
  const v1 = await getQuoteView(security.id, { force: true });
  await new Promise((res) => setTimeout(res, 2_500));
  const v2 = await getQuoteView(security.id, { force: true });
  const after = await db.dataFetch.count({ where: { securityId: security.id, dataset: "quote" } });
  const ids = [...v1.attempts, ...v2.attempts].map((a) => a.fetchId);
  record({
    ticker,
    test: "E2E Refresh Now = new request",
    result: after - before >= 2 && new Set(ids).size === ids.length && v2.attempts.some((a) => a.ok) ? "PASS" : "FAIL",
    detail: `${after - before} new provider requests; status ${v2.status} via ${v2.provider?.key ?? "—"} ${v2.price ?? "—"} @ ${v2.sourceTimestamp ? nyTime(v2.sourceTimestamp) : "—"}; verification ${v2.verification.status}${v2.verification.note ? ` (${v2.verification.note})` : ""}`,
    evidence: { attempts: [...v1.attempts, ...v2.attempts], status: v2.status, reasons: v2.reasons },
  });

  const p = await getMetricProvenance(security.id);
  const incomplete = p.records.filter((m) => !m.provider.key || !m.periodEnd || !m.publishedAt || !m.retrievedAt || !m.unit || !m.verificationStatus || (m.provider.key === "sec-edgar" && !m.sourceUrl));
  record({
    ticker,
    test: "E2E provenance on every metric",
    result: p.records.length > 0 && incomplete.length === 0 ? "PASS" : "FAIL",
    detail: `${p.records.length} stored figures, ${incomplete.length} missing a provenance field; statements status ${p.fundamentalsStatus.status} (${p.fundamentalsStatus.reasons.join(", ")})`,
    evidence: { coverage: p.coverage, fundamentalsStatus: p.fundamentalsStatus, sample: p.records.filter((m) => m.fiscalYear === p.coverage.annualYears.last && m.periodType !== "QUARTERLY").slice(0, 12) },
  });
  out(`    coverage: ${p.coverage.annualYears.count} FY (${p.coverage.annualYears.first}–${p.coverage.annualYears.last}), ${p.coverage.quarterlyPeriods.count} quarters, ${p.coverage.dailyPrices.years} y of daily prices, dividends in ${p.coverage.dividends.calendarYears} calendar years (${p.coverage.dividends.verified} payments cross-checked with SEC)`);
  if (p.coverage.gaps.length) out(`    gaps (last 10 FY): ${p.coverage.gaps.map((g) => `FY${g.fiscalYear}: ${g.missing.join("/")}`).join("; ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const tickers = args.filter((a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1)).map((t) => t.toUpperCase());
  const list = tickers.length ? tickers : ["MSFT", "NVDA", "GOOGL"];
  const e = env();
  out(`Free-provider validation ${new Date().toISOString()} — ${list.join(", ")}`);
  out(`Configured: SEC_USER_AGENT=${e.SEC_USER_AGENT ? "set" : "MISSING"} TIINGO_API_KEY=${e.TIINGO_API_KEY ? `set (plan ${e.TIINGO_PLAN ?? "free"})` : "MISSING"} FINNHUB_API_KEY=${e.FINNHUB_API_KEY ? "set" : "missing"} TWELVE_DATA_API_KEY=${e.TWELVE_DATA_API_KEY ? "set" : "missing"} FMP_API_KEY=${e.FMP_API_KEY ? "set (Basic only)" : "not set (optional)"}`);

  // One SEC request maps tickers to CIK and listing exchange.
  let universe = new Map<string, { cik: string | null; exchangeCode: string }>();
  try {
    const { entries } = await secEdgarReference.listUniverse();
    universe = new Map(entries.map((x) => [x.ticker.toUpperCase(), { cik: x.cik, exchangeCode: x.exchangeCode }]));
  } catch (err) {
    record(failure("*", "SEC ticker file", err));
  }
  // Published SEC CIKs, used only if the ticker file itself could not be fetched.
  const KNOWN_CIK: Record<string, string> = { MSFT: "789019", NVDA: "1045810", GOOGL: "1652044" };
  for (const t of list) await validateTicker(t, universe.get(t)?.cik ?? KNOWN_CIK[t] ?? null, universe.get(t)?.exchangeCode ?? "NASDAQ");
  if (args.includes("--db")) {
    for (const t of list) {
      try {
        await validateEndToEnd(t);
      } catch (err) {
        record(failure(t, "E2E", err));
      }
    }
  }

  const tally = (r: Result) => checks.filter((c) => c.result === r).length;
  out(`\nSummary: ${tally("PASS")} PASS · ${tally("FAIL")} FAIL · ${tally("BLOCKED")} BLOCKED · ${tally("SKIPPED")} SKIPPED`);
  if (outPath) {
    writeFileSync(outPath, mask(JSON.stringify({ ranAt: new Date().toISOString(), tickers: list, checks }, null, 2)));
    out(`Report written to ${outPath}`);
  }
  process.exitCode = tally("FAIL") > 0 ? 1 : tally("BLOCKED") > 0 ? 2 : 0;
}

main()
  .catch((err) => {
    console.error(mask(err instanceof Error ? (err.stack ?? err.message) : String(err)));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.argv.includes("--db")) (await import("@/server/db")).db.$disconnect();
  });
