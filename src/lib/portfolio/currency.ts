/**
 * Currencies and price units (pure).
 *
 * Supported trading currencies are USD (US exchanges) and ILS (TASE). TASE
 * quotes most securities in agorot (ILA, 1/100 shekel); every amount is
 * normalized to the major unit (ILS) before it is stored or added up, and the
 * unit it was entered in is kept for audit. Amounts in different currencies
 * are never added together without an explicit, sourced FX rate (see ./fx).
 */

export const CURRENCIES = ["USD", "ILS"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Units a price can be entered in. ILA = agorot (1/100 ILS). */
export const PRICE_UNITS = ["USD", "ILS", "ILA"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const isCurrency = (v: unknown): v is Currency => v === "USD" || v === "ILS";

/** Currency a price unit belongs to. */
export function unitCurrency(unit: PriceUnit): Currency {
  return unit === "USD" ? "USD" : "ILS";
}

/** Divisor from the entered unit to the major unit. */
export function unitDivisor(unit: PriceUnit): number {
  return unit === "ILA" ? 100 : 1;
}

/** Convert an amount entered in `unit` into the major unit of its currency. */
export function toMajorUnit(amount: number, unit: PriceUnit): { amount: number; currency: Currency } {
  return { amount: amount / unitDivisor(unit), currency: unitCurrency(unit) };
}

/**
 * Parse a user-supplied unit / currency label. Accepts ISO codes and the
 * common spellings of agorot. Returns null when the label is not recognized
 * (the caller reports it instead of guessing).
 */
export function parsePriceUnit(raw: string | null | undefined): PriceUnit | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (s === "USD" || s === "$" || s === "US$" || s === "DOLLAR" || s === "DOLLARS") return "USD";
  if (s === "ILS" || s === "NIS" || s === "₪" || s === "SHEKEL" || s === "SHEKELS" || s === "שח" || s === 'ש"ח' || s === "ש״ח") return "ILS";
  if (s === "ILA" || s === "ILX" || s === "AGOROT" || s === "AGORA" || s === "AGOROTH" || s === "אגורות" || s === "אג" || s === "אג'") return "ILA";
  return null;
}

/** Parse a currency label (agorot is a unit of ILS, not a currency, and maps to ILS with a flag). */
export function parseCurrency(raw: string | null | undefined): { currency: Currency; impliesAgorot: boolean } | null {
  const unit = parsePriceUnit(raw);
  if (!unit) return null;
  return { currency: unitCurrency(unit), impliesAgorot: unit === "ILA" };
}

/** Trading currency of an exchange, by market. */
export function marketCurrency(market: "US" | "IL" | "OTHER"): Currency | null {
  return market === "US" ? "USD" : market === "IL" ? "ILS" : null;
}

/** Round half away from zero to `dp` decimals (avoids 0.1 + 0.2 artifacts in displayed money). */
export function roundTo(v: number, dp: number): number {
  if (!Number.isFinite(v)) return v;
  // Shift by decimal exponent (not by multiplying): 1.005 * 100 is 100.49999…, "1.005e2" is exactly 100.5.
  const abs = String(Math.abs(v));
  if (abs.includes("e")) return Math.sign(v) * Math.round(Math.abs(v) * 10 ** dp) / 10 ** dp;
  const shifted = Math.round(Number(`${abs}e${dp}`));
  return Math.sign(v) * Number(`${shifted}e-${dp}`);
}
