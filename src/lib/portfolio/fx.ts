/**
 * FX conversion (pure). A converted value is only produced from a sourced
 * rate: the Bank of Israel representative rate (OFFICIAL) or a rate the user
 * typed in with its date and source (MANUAL). Without a usable rate the
 * conversion returns null and callers show separate currency totals.
 * Nothing here ever invents, interpolates or extrapolates a rate.
 */
import type { Currency } from "./currency";

export interface FxRateRecord {
  /** 1 `base` = `rate` `quote`. */
  base: Currency;
  quote: Currency;
  rate: number;
  /** Date the rate applies to (YYYY-MM-DD). */
  date: string;
  kind: "OFFICIAL" | "MANUAL";
  sourceLabel: string;
}

export interface FxPolicy {
  /** A rate older than this (calendar days before `asOf`) is not used. */
  maxAgeDays: number;
  /** Accept user-entered rates (labelled as such) when no official rate qualifies. */
  allowManual: boolean;
}

/** Bank of Israel publishes on Israeli business days only; a week covers holidays and weekends. */
export const DEFAULT_FX_POLICY: FxPolicy = { maxAgeDays: 7, allowManual: true };

export interface FxConversion {
  from: Currency;
  to: Currency;
  /** Multiply an amount in `from` by this to get `to`. */
  factor: number;
  rate: FxRateRecord;
  /** True when the stored rate is quoted the other way round (factor = 1 / rate). */
  inverted: boolean;
  ageDays: number;
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);

export type FxUnavailableReason = "NO_RATE" | "RATE_TOO_OLD" | "RATE_AFTER_AS_OF" | "INVALID_RATE";

/**
 * Pick the rate to convert `from` → `to` as of `asOf`: the most recent rate on
 * or before `asOf` within `maxAgeDays`; official rates win over manual ones
 * of the same or an older date.
 */
export function resolveFx(
  from: Currency,
  to: Currency,
  rates: FxRateRecord[],
  asOf: string,
  policy: FxPolicy = DEFAULT_FX_POLICY,
): { ok: true; conversion: FxConversion } | { ok: false; reason: FxUnavailableReason } {
  if (from === to) {
    return { ok: true, conversion: { from, to, factor: 1, inverted: false, ageDays: 0, rate: { base: from, quote: to, rate: 1, date: asOf, kind: "OFFICIAL", sourceLabel: "identity" } } };
  }
  const candidates = rates.filter((r) => (r.base === from && r.quote === to) || (r.base === to && r.quote === from));
  if (!candidates.length) return { ok: false, reason: "NO_RATE" };
  const valid = candidates.filter((r) => Number.isFinite(r.rate) && r.rate > 0);
  if (!valid.length) return { ok: false, reason: "INVALID_RATE" };
  const notAfter = valid.filter((r) => r.date <= asOf && (policy.allowManual || r.kind === "OFFICIAL"));
  if (!notAfter.length) return { ok: false, reason: valid.some((r) => r.date > asOf) ? "RATE_AFTER_AS_OF" : "NO_RATE" };
  const fresh = notAfter.filter((r) => days(r.date, asOf) <= policy.maxAgeDays);
  if (!fresh.length) return { ok: false, reason: "RATE_TOO_OLD" };
  fresh.sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? 0 : a.kind === "OFFICIAL" ? -1 : 1) : a.date < b.date ? 1 : -1));
  const best = fresh[0];
  const inverted = best.base !== from;
  return { ok: true, conversion: { from, to, factor: inverted ? 1 / best.rate : best.rate, rate: best, inverted, ageDays: days(best.date, asOf) } };
}

export function convert(amount: number, conversion: FxConversion): number {
  return amount * conversion.factor;
}
