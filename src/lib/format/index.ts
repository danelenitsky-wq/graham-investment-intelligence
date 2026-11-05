/**
 * Locale-aware number formatting. Missing values render as an em dash and are
 * never coerced to zero. Numbers are wrapped by <Num> in the UI with dir="ltr"
 * so signs and units read correctly inside RTL text.
 */
export const MISSING = "—";

type N = number | null | undefined;

/**
 * Numbers use en-US conventions in both locales ($1,234.56, 12.5%), as is
 * customary in Israeli financial media; dates are fully localized.
 */
function tag(_locale: string) {
  void _locale;
  return "en-US";
}
function dateTag(locale: string) {
  return locale === "he" ? "he-IL" : "en-US";
}

export function formatNumber(locale: string, v: N, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  return new Intl.NumberFormat(tag(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function formatInteger(locale: string, v: N): string {
  return formatNumber(locale, v, 0);
}

export function formatCurrency(locale: string, v: N, currency = "USD", digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  return new Intl.NumberFormat(tag(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

/** 1.23B / 456.7M style for large amounts. */
export function formatCompact(locale: string, v: N, currency?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  return new Intl.NumberFormat(tag(locale), {
    notation: "compact",
    maximumFractionDigits: 2,
    ...(currency ? { style: "currency", currency } : {}),
  }).format(v);
}

export function formatPercent(locale: string, v: N, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  return new Intl.NumberFormat(tag(locale), { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function formatRatio(locale: string, v: N, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  return `${formatNumber(locale, v, digits)}×`;
}

export function formatDate(locale: string, iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  if (!iso) return MISSING;
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return MISSING;
  return new Intl.DateTimeFormat(dateTag(locale), { timeZone: "UTC", ...opts }).format(d);
}

export type MetricFormat = "currency" | "compactCurrency" | "number" | "integer" | "percent" | "ratio" | "multiple";

export function formatMetric(locale: string, v: N, format: MetricFormat, currency = "USD"): string {
  switch (format) {
    case "currency":
      return formatCurrency(locale, v, currency);
    case "compactCurrency":
      return formatCompact(locale, v, currency);
    case "integer":
      return formatInteger(locale, v);
    case "percent":
      return formatPercent(locale, v);
    case "ratio":
      return formatNumber(locale, v, 2);
    case "multiple":
      return formatRatio(locale, v, 1);
    default:
      return formatNumber(locale, v, 2);
  }
}
