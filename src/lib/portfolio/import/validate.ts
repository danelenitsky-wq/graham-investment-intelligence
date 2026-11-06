/**
 * Holding import validation (pure). Every import source — the manual form,
 * CSV files and, later, PDF broker statements — produces `RawHoldingRow`s that
 * go through this single validator before a preview is shown. Nothing is
 * saved until the user confirms a preview without errors.
 *
 * Rules: symbols must look like symbols of their exchange; the currency must
 * be the exchange's trading currency (USD for US exchanges, ILS for TASE), so
 * currencies are never mixed inside a position; Israeli prices must state
 * their unit (ILS or agorot) explicitly; quantities and prices must be
 * positive; dates are ISO (YYYY-MM-DD) and not in the future.
 */
import { parseCurrency, parsePriceUnit, toMajorUnit, unitCurrency, type Currency, type PriceUnit } from "../currency";

export const HOLDING_FIELDS = [
  "ticker",
  "exchange",
  "securityType",
  "quantity",
  "averagePrice",
  "currency",
  "priceUnit",
  "purchaseDate",
  "notes",
  "name",
  "taseSecurityNumber",
  "thesisStrategy",
] as const;
export type HoldingField = (typeof HOLDING_FIELDS)[number];

export interface RawHoldingRow {
  /** 1-based line in the source (file line, or 1 for the manual form). */
  line: number;
  fields: Partial<Record<HoldingField, string>>;
}

export const SECURITY_TYPES = ["COMMON_STOCK", "PREFERRED_STOCK", "ADR", "ETF", "REIT", "OTHER"] as const;
export type SecurityType = (typeof SECURITY_TYPES)[number];

export type Market = "US" | "IL";

/** Exchange codes the platform knows, with their market. Aliases map to the canonical code. */
export const EXCHANGE_MARKETS: Record<string, Market> = {
  NASDAQ: "US",
  NYSE: "US",
  NYSEAMERICAN: "US",
  NYSEARCA: "US",
  CBOE: "US",
  OTC: "US",
  TASE: "IL",
};

const EXCHANGE_ALIASES: Record<string, string> = {
  NASDAQ: "NASDAQ",
  XNAS: "NASDAQ",
  NYSE: "NYSE",
  XNYS: "NYSE",
  AMEX: "NYSEAMERICAN",
  NYSEAMERICAN: "NYSEAMERICAN",
  NYSEMKT: "NYSEAMERICAN",
  ARCA: "NYSEARCA",
  NYSEARCA: "NYSEARCA",
  CBOE: "CBOE",
  BATS: "CBOE",
  OTC: "OTC",
  OTCMKTS: "OTC",
  TASE: "TASE",
  TLV: "TASE",
  TA: "TASE",
  XTAE: "TASE",
  "תא": "TASE",
  'ת"א': "TASE",
  "בורסתתא": "TASE",
};

export function canonicalExchange(raw: string | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toUpperCase().replace(/[\s_-]+/g, "");
  return EXCHANGE_ALIASES[k] ?? null;
}

const TYPE_ALIASES: Record<string, SecurityType> = {
  STOCK: "COMMON_STOCK",
  COMMON: "COMMON_STOCK",
  COMMONSTOCK: "COMMON_STOCK",
  EQUITY: "COMMON_STOCK",
  SHARE: "COMMON_STOCK",
  SHARES: "COMMON_STOCK",
  "מניה": "COMMON_STOCK",
  ETF: "ETF",
  FUND: "ETF",
  ETN: "ETF",
  "קרןסל": "ETF",
  "תעודתסל": "ETF",
  PREFERRED: "PREFERRED_STOCK",
  PREFERREDSTOCK: "PREFERRED_STOCK",
  PFD: "PREFERRED_STOCK",
  ADR: "ADR",
  REIT: "REIT",
  OTHER: "OTHER",
};

export function parseSecurityType(raw: string | undefined): SecurityType | null {
  if (!raw) return null;
  return TYPE_ALIASES[raw.trim().toUpperCase().replace(/[\s_"'״-]+/g, "")] ?? null;
}

/** "1234.5", "1,234.5" (thousands separators), " 12 ". Rejects "1.234,5", "1e3", "12abc". */
export function parseDecimal(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  return NaN;
}

const decimals = (raw: string) => {
  const m = raw.trim().replace(/,/g, "").match(/\.(\d+)$/);
  return m ? m[1].length : 0;
};

const US_SYMBOL = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
const TASE_SYMBOL = /^[A-Z0-9][A-Z0-9.]{0,11}$/;
const TASE_NUMBER = /^\d{5,9}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type IssueSeverity = "ERROR" | "WARNING";
export type IssueCode =
  | "REQUIRED"
  | "UNKNOWN_EXCHANGE"
  | "INVALID_SYMBOL"
  | "INVALID_SECURITY_NUMBER"
  | "UNKNOWN_SECURITY_TYPE"
  | "INVALID_NUMBER"
  | "NOT_POSITIVE"
  | "TOO_MANY_DECIMALS"
  | "TOO_LARGE"
  | "UNKNOWN_CURRENCY"
  | "CURRENCY_EXCHANGE_MISMATCH"
  | "UNKNOWN_PRICE_UNIT"
  | "PRICE_UNIT_CURRENCY_MISMATCH"
  | "PRICE_UNIT_REQUIRED"
  | "DATE_FORMAT"
  | "DATE_IN_FUTURE"
  | "DATE_TOO_OLD"
  | "TEXT_TOO_LONG"
  | "UNKNOWN_STRATEGY"
  | "DUPLICATE_MERGED"
  | "DUPLICATE_CURRENCY_CONFLICT"
  | "FRACTIONAL_QUANTITY"
  // Added by the server when it resolves the security (see server/portfolio-import.ts)
  | "SECURITY_NOT_FOUND"
  | "SECURITY_WILL_BE_CREATED"
  | "SECURITY_TYPE_DIFFERS"
  | "PRICE_UNIT_SUSPECT"
  | "MERGES_INTO_EXISTING";

export interface RowIssue {
  code: IssueCode;
  severity: IssueSeverity;
  field: HoldingField | null;
  params?: Record<string, string | number>;
}

export interface HoldingDraft {
  ticker: string;
  exchange: string;
  market: Market;
  securityType: SecurityType;
  quantity: number;
  /** Average purchase price per share in the major unit (USD / ILS). */
  averagePrice: number;
  currency: Currency;
  /** The price as entered, in `priceUnit`. */
  enteredPrice: number;
  priceUnit: PriceUnit;
  purchaseDate: string | null;
  notes: string | null;
  name: string | null;
  taseSecurityNumber: string | null;
  thesisStrategy: "DEFENSIVE" | "ENTERPRISING" | "NET_NET" | null;
}

export interface ValidatedRow {
  line: number;
  raw: Partial<Record<HoldingField, string>>;
  issues: RowIssue[];
  draft: HoldingDraft | null;
}

export const hasErrors = (r: { issues: RowIssue[] }) => r.issues.some((i) => i.severity === "ERROR");

const err = (code: IssueCode, field: HoldingField | null, params?: RowIssue["params"]): RowIssue => ({ code, severity: "ERROR", field, ...(params && { params }) });
const warn = (code: IssueCode, field: HoldingField | null, params?: RowIssue["params"]): RowIssue => ({ code, severity: "WARNING", field, ...(params && { params }) });

export const LIMITS = { maxQuantity: 1e12, maxPrice: 1e9, quantityDecimals: 8, priceDecimals: 6, notes: 500, name: 200 };

export function validateHoldingRow(row: RawHoldingRow, today: string): ValidatedRow {
  const f = row.fields;
  const issues: RowIssue[] = [];
  const text = (k: HoldingField) => (f[k] ?? "").trim();

  // Exchange
  const exchange = canonicalExchange(text("exchange"));
  if (!text("exchange")) issues.push(err("REQUIRED", "exchange"));
  else if (!exchange) issues.push(err("UNKNOWN_EXCHANGE", "exchange", { value: text("exchange") }));
  const market = exchange ? EXCHANGE_MARKETS[exchange] : null;

  // Symbol
  const ticker = text("ticker").toUpperCase();
  const secNo = text("taseSecurityNumber");
  if (!ticker) issues.push(err("REQUIRED", "ticker"));
  else if (market === "US" && !US_SYMBOL.test(ticker)) issues.push(err("INVALID_SYMBOL", "ticker", { value: ticker }));
  else if (market === "IL" && !TASE_SYMBOL.test(ticker)) issues.push(err("INVALID_SYMBOL", "ticker", { value: ticker }));
  if (secNo && (market !== "IL" || !TASE_NUMBER.test(secNo))) issues.push(err("INVALID_SECURITY_NUMBER", "taseSecurityNumber", { value: secNo }));

  // Type
  const securityType = parseSecurityType(text("securityType"));
  if (!text("securityType")) issues.push(err("REQUIRED", "securityType"));
  else if (!securityType) issues.push(err("UNKNOWN_SECURITY_TYPE", "securityType", { value: text("securityType") }));

  // Quantity
  const qRaw = text("quantity");
  const quantity = parseDecimal(qRaw);
  if (!qRaw) issues.push(err("REQUIRED", "quantity"));
  else if (quantity === null || Number.isNaN(quantity)) issues.push(err("INVALID_NUMBER", "quantity", { value: qRaw }));
  else if (!(quantity > 0)) issues.push(err("NOT_POSITIVE", "quantity"));
  else if (quantity > LIMITS.maxQuantity) issues.push(err("TOO_LARGE", "quantity"));
  else if (decimals(qRaw) > LIMITS.quantityDecimals) issues.push(err("TOO_MANY_DECIMALS", "quantity", { max: LIMITS.quantityDecimals }));
  else if (market === "IL" && !Number.isInteger(quantity)) issues.push(warn("FRACTIONAL_QUANTITY", "quantity"));

  // Currency and unit
  const curRaw = text("currency");
  const cur = parseCurrency(curRaw);
  if (!curRaw) issues.push(err("REQUIRED", "currency"));
  else if (!cur) issues.push(err("UNKNOWN_CURRENCY", "currency", { value: curRaw }));
  const expected: Currency | null = market === "US" ? "USD" : market === "IL" ? "ILS" : null;
  if (cur && expected && cur.currency !== expected) issues.push(err("CURRENCY_EXCHANGE_MISMATCH", "currency", { currency: cur.currency, exchange: exchange!, expected }));

  const unitRaw = text("priceUnit");
  let unit: PriceUnit | null = null;
  if (unitRaw) {
    unit = parsePriceUnit(unitRaw);
    if (!unit) issues.push(err("UNKNOWN_PRICE_UNIT", "priceUnit", { value: unitRaw }));
    else if (cur && unitCurrency(unit) !== cur.currency) issues.push(err("PRICE_UNIT_CURRENCY_MISMATCH", "priceUnit", { unit, currency: cur.currency }));
    else if (cur?.impliesAgorot && unit !== "ILA") issues.push(err("PRICE_UNIT_CURRENCY_MISMATCH", "priceUnit", { unit, currency: "ILA" }));
  } else if (cur) {
    if (cur.impliesAgorot) unit = "ILA";
    else if (cur.currency === "USD") unit = "USD";
    // TASE prices are quoted in agorot on the exchange but often written in shekels: never guess which.
    else issues.push(err("PRICE_UNIT_REQUIRED", "priceUnit"));
  }

  // Price
  const pRaw = text("averagePrice");
  const price = parseDecimal(pRaw);
  if (!pRaw) issues.push(err("REQUIRED", "averagePrice"));
  else if (price === null || Number.isNaN(price)) issues.push(err("INVALID_NUMBER", "averagePrice", { value: pRaw }));
  else if (!(price > 0)) issues.push(err("NOT_POSITIVE", "averagePrice"));
  else if (price > LIMITS.maxPrice) issues.push(err("TOO_LARGE", "averagePrice"));
  else if (decimals(pRaw) > LIMITS.priceDecimals) issues.push(err("TOO_MANY_DECIMALS", "averagePrice", { max: LIMITS.priceDecimals }));

  // Date
  const dRaw = text("purchaseDate");
  let purchaseDate: string | null = null;
  if (dRaw) {
    const m = dRaw.match(ISO_DATE);
    const valid = m && (() => {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
    })();
    if (!valid) issues.push(err("DATE_FORMAT", "purchaseDate", { value: dRaw }));
    else if (dRaw > today) issues.push(err("DATE_IN_FUTURE", "purchaseDate", { value: dRaw }));
    else if (dRaw < "1900-01-01") issues.push(err("DATE_TOO_OLD", "purchaseDate", { value: dRaw }));
    else purchaseDate = dRaw;
  }

  const notes = text("notes") || null;
  if (notes && notes.length > LIMITS.notes) issues.push(err("TEXT_TOO_LONG", "notes", { max: LIMITS.notes }));
  const name = text("name") || null;
  if (name && name.length > LIMITS.name) issues.push(err("TEXT_TOO_LONG", "name", { max: LIMITS.name }));

  const stratRaw = text("thesisStrategy").toUpperCase().replace(/[\s-]/g, "_");
  const thesisStrategy = stratRaw === "" ? null : stratRaw === "DEFENSIVE" || stratRaw === "ENTERPRISING" || stratRaw === "NET_NET" ? stratRaw : undefined;
  if (thesisStrategy === undefined) issues.push(err("UNKNOWN_STRATEGY", "thesisStrategy", { value: text("thesisStrategy") }));

  const ok = !issues.some((i) => i.severity === "ERROR");
  const draft: HoldingDraft | null =
    ok && exchange && market && securityType && quantity && price && cur && unit && thesisStrategy !== undefined
      ? {
          ticker,
          exchange,
          market,
          securityType,
          quantity,
          averagePrice: toMajorUnit(price, unit).amount,
          currency: cur.currency,
          enteredPrice: price,
          priceUnit: unit,
          purchaseDate,
          notes,
          name,
          taseSecurityNumber: secNo || null,
          thesisStrategy,
        }
      : null;
  return { line: row.line, raw: f, issues, draft };
}

/**
 * Validate every row, then flag duplicates of the same exchange + symbol:
 * same currency → merged into one position (weighted average, warning);
 * different currencies → error (currencies are never mixed in a position).
 */
export function validateHoldingRows(rows: RawHoldingRow[], today: string): ValidatedRow[] {
  const out = rows.map((r) => validateHoldingRow(r, today));
  const groups = new Map<string, ValidatedRow[]>();
  for (const r of out) {
    if (!r.draft) continue;
    const k = `${r.draft.exchange}:${r.draft.ticker}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const currencies = new Set(g.map((r) => r.draft!.currency));
    const lines = g.map((r) => r.line).join(", ");
    for (const r of g) {
      if (currencies.size > 1) {
        r.issues.push(err("DUPLICATE_CURRENCY_CONFLICT", "currency", { lines }));
        r.draft = null;
      } else r.issues.push(warn("DUPLICATE_MERGED", "ticker", { lines }));
    }
  }
  return out;
}

export interface MergedHolding extends HoldingDraft {
  lines: number[];
}

/** Combine valid rows of the same security (quantity-weighted average price, earliest date, joined notes). */
export function mergeDrafts(rows: ValidatedRow[]): MergedHolding[] {
  const map = new Map<string, MergedHolding>();
  for (const r of rows) {
    const d = r.draft;
    if (!d || hasErrors(r)) continue;
    const k = `${d.exchange}:${d.ticker}`;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...d, lines: [r.line] });
      continue;
    }
    const q = prev.quantity + d.quantity;
    prev.averagePrice = (prev.quantity * prev.averagePrice + d.quantity * d.averagePrice) / q;
    prev.enteredPrice = (prev.quantity * prev.enteredPrice + d.quantity * d.enteredPrice * (prev.priceUnit === d.priceUnit ? 1 : d.priceUnit === "ILA" ? 0.01 : 100)) / q;
    prev.quantity = q;
    prev.purchaseDate = [prev.purchaseDate, d.purchaseDate].filter((x): x is string => Boolean(x)).sort()[0] ?? null;
    prev.notes = [prev.notes, d.notes].filter(Boolean).join(" · ") || null;
    prev.name ??= d.name;
    prev.taseSecurityNumber ??= d.taseSecurityNumber;
    prev.thesisStrategy ??= d.thesisStrategy;
    prev.lines.push(r.line);
  }
  return [...map.values()];
}
