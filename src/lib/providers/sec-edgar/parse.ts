/** Pure parsers for SEC EDGAR payloads (no I/O, unit-tested). */
import type { FilingRef, UniverseEntry } from "../types";
import type { Submissions, TickerExchangeFile } from "./types";

const EXCHANGE_MAP: Record<string, string> = {
  nasdaq: "NASDAQ",
  nyse: "NYSE",
  "nyse american": "NYSEAMERICAN",
  "nyse mkt": "NYSEAMERICAN",
  "nyse arca": "NYSEARCA",
  cboe: "CBOE",
  otc: "OTC",
};

export function canonicalExchange(secExchange: string | null | undefined): string | null {
  if (!secExchange) return null;
  return EXCHANGE_MAP[secExchange.trim().toLowerCase()] ?? null;
}

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

export function parseTickerExchangeFile(file: TickerExchangeFile): UniverseEntry[] {
  const idx = (name: string) => file.fields.indexOf(name);
  const [iCik, iName, iTicker, iExchange] = [idx("cik"), idx("name"), idx("ticker"), idx("exchange")];
  if ([iCik, iName, iTicker, iExchange].some((i) => i < 0)) {
    throw new Error(`Unexpected company_tickers_exchange fields: ${file.fields.join(",")}`);
  }
  const out: UniverseEntry[] = [];
  const seen = new Set<string>();
  for (const row of file.data) {
    const ticker = row[iTicker];
    const name = row[iName];
    const exchangeCode = canonicalExchange(row[iExchange] as string | null);
    if (typeof ticker !== "string" || typeof name !== "string" || !exchangeCode) continue;
    const key = `${ticker.toUpperCase()}@${exchangeCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ticker: ticker.toUpperCase(), name, exchangeCode, cik: row[iCik] === null ? null : padCik(row[iCik] as number) });
  }
  return out;
}

export const PERIODIC_FORMS = new Set(["10-K", "10-K/A", "10-KT", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A"]);

/** Public EDGAR folder for a filing (the original source document set). */
export function filingUrl(cik: string | number, accessionNumber: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(String(cik).replace(/\D/g, ""))}/${accessionNumber.replace(/-/g, "")}/`;
}

/** Periodic reports from a submissions payload, newest first. */
export function parsePeriodicFilings(sub: Submissions): FilingRef[] {
  const r = sub.filings?.recent;
  if (!r) return [];
  const out: FilingRef[] = [];
  for (let i = 0; i < r.accessionNumber.length; i++) {
    if (!PERIODIC_FORMS.has(r.form[i])) continue;
    const accepted = r.acceptanceDateTime?.[i] ?? null;
    out.push({
      accessionNumber: r.accessionNumber[i],
      form: r.form[i],
      filingDate: r.filingDate[i],
      acceptedAt: accepted && Number.isFinite(Date.parse(accepted)) ? new Date(accepted).toISOString() : null,
      reportDate: r.reportDate?.[i] || null,
      url: filingUrl(sub.cik, r.accessionNumber[i]),
    });
  }
  return out.sort((a, b) => b.filingDate.localeCompare(a.filingDate) || (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""));
}
