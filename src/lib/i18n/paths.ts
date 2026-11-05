import type { Locale } from "./index";

/** Build a locale-prefixed app path. */
export function href(locale: Locale | string, path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p === "/" ? `/${locale}` : `/${locale}${p}`;
}

export function securityPath(locale: Locale | string, exchangeCode: string, ticker: string): string {
  return href(locale, `/stocks/${encodeURIComponent(exchangeCode)}/${encodeURIComponent(ticker)}`);
}

/** "NASDAQ:EXM" ↔ { exchange, ticker } — used in ?s= query parameters. */
export function parseSymbolParam(v: string | string[] | undefined): { exchange: string; ticker: string } | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const [exchange, ticker] = s.split(":");
  if (!exchange || !ticker) return null;
  return { exchange: exchange.toUpperCase(), ticker: ticker.toUpperCase() };
}
