/** Pure parsers for SEC EDGAR payloads (no I/O, unit-tested). */
import type { UniverseEntry } from "../types";
import type { TickerExchangeFile } from "./types";

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
