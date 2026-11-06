/**
 * Import sources. Each source turns a document into `RawHoldingRow`s; all of
 * them share one validator, one preview and one confirmation step.
 *
 * - CSV (implemented): header-mapped columns, English or Hebrew names.
 * - PDF broker statements (prepared, not implemented): the extractor contract
 *   below is what a future local implementation plugs into. It is meant to run
 *   locally (text layer via pdf.js, or `pdftotext` when installed) with
 *   per-broker layout templates; no paid document-extraction service is
 *   required or called. Until an extractor is registered it reports
 *   NOT_IMPLEMENTED instead of guessing at a statement's contents.
 */
import { CsvError, parseCsv } from "./csv";
import type { HoldingField, RawHoldingRow } from "./validate";

export type ImportSourceKind = "CSV" | "PDF_STATEMENT";

export interface ExtractionResult {
  kind: ImportSourceKind;
  rows: RawHoldingRow[];
  /** Columns / fields the source could not map (shown in the preview). */
  unmappedColumns: string[];
  /** Fields that no column provided. */
  missingColumns: HoldingField[];
  /** Source-level problems (e.g. not a CSV, unterminated quote). */
  errors: { code: string; message: string; line?: number }[];
}

export interface StatementExtractor {
  kind: ImportSourceKind;
  /** e.g. "csv", or a broker template id for PDF statements. */
  id: string;
  extract(input: { fileName: string | null; bytes?: Uint8Array; text?: string }): Promise<ExtractionResult>;
}

/** Column header → field. Case, spaces, dashes and underscores are ignored. */
const HEADER_ALIASES: Record<string, HoldingField> = {
  ticker: "ticker",
  symbol: "ticker",
  "סימול": "ticker",
  exchange: "exchange",
  market: "exchange",
  "בורסה": "exchange",
  securitytype: "securityType",
  type: "securityType",
  assettype: "securityType",
  "סוג": "securityType",
  "סוגנייר": "securityType",
  quantity: "quantity",
  qty: "quantity",
  shares: "quantity",
  units: "quantity",
  "כמות": "quantity",
  averagepurchaseprice: "averagePrice",
  averageprice: "averagePrice",
  avgprice: "averagePrice",
  averagecost: "averagePrice",
  costpershare: "averagePrice",
  price: "averagePrice",
  "מחירממוצע": "averagePrice",
  "שערקנייהממוצע": "averagePrice",
  purchasecurrency: "currency",
  currency: "currency",
  "מטבע": "currency",
  priceunit: "priceUnit",
  unit: "priceUnit",
  "יחידתמחיר": "priceUnit",
  purchasedate: "purchaseDate",
  date: "purchaseDate",
  tradedate: "purchaseDate",
  "תאריךרכישה": "purchaseDate",
  notes: "notes",
  note: "notes",
  comment: "notes",
  "הערות": "notes",
  name: "name",
  companyname: "name",
  securityname: "name",
  "שם": "name",
  tasesecuritynumber: "taseSecurityNumber",
  securitynumber: "taseSecurityNumber",
  securityid: "taseSecurityNumber",
  "מספרנייר": "taseSecurityNumber",
  "מספרניירערך": "taseSecurityNumber",
  thesis: "thesisStrategy",
  strategy: "thesisStrategy",
  thesisstrategy: "thesisStrategy",
};

export function mapHeader(h: string): HoldingField | null {
  return HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s_\-"'״׳.()]+/g, "")] ?? null;
}

const REQUIRED_COLUMNS: HoldingField[] = ["ticker", "exchange", "securityType", "quantity", "averagePrice", "currency"];

export function extractCsv(text: string): ExtractionResult {
  try {
    const t = parseCsv(text);
    const mapping = t.header.map(mapHeader);
    const seen = new Set<HoldingField>();
    const errors: ExtractionResult["errors"] = [];
    mapping.forEach((m, i) => {
      if (!m) return;
      if (seen.has(m)) errors.push({ code: "DUPLICATE_COLUMN", message: `Column "${t.header[i]}" maps to ${m} twice.` });
      seen.add(m);
    });
    const missing = REQUIRED_COLUMNS.filter((f) => !seen.has(f));
    const rows: RawHoldingRow[] = t.rows.map((r) => {
      const fields: RawHoldingRow["fields"] = {};
      mapping.forEach((m, i) => {
        if (m && r.cells[i] !== undefined) fields[m] = r.cells[i];
      });
      return { line: r.line, fields };
    });
    return { kind: "CSV", rows, unmappedColumns: t.header.filter((_, i) => !mapping[i] && t.header[i] !== ""), missingColumns: missing, errors };
  } catch (e) {
    if (e instanceof CsvError) return { kind: "CSV", rows: [], unmappedColumns: [], missingColumns: [], errors: [{ code: e.code, message: e.message, line: e.line }] };
    throw e;
  }
}

export const csvExtractor: StatementExtractor = {
  kind: "CSV",
  id: "csv",
  async extract({ text, bytes }) {
    return extractCsv(text ?? new TextDecoder("utf-8").decode(bytes ?? new Uint8Array()));
  },
};

/** Placeholder for the future local PDF statement extractor. */
export const pdfStatementExtractor: StatementExtractor = {
  kind: "PDF_STATEMENT",
  id: "pdf-not-implemented",
  async extract() {
    return {
      kind: "PDF_STATEMENT",
      rows: [],
      unmappedColumns: [],
      missingColumns: [],
      errors: [{ code: "NOT_IMPLEMENTED", message: "PDF statement import is not implemented yet. Export a CSV from your broker instead." }],
    };
  },
};

export const IMPORT_TEMPLATE_CSV = [
  "ticker,exchange,security_type,quantity,average_price,currency,price_unit,purchase_date,notes",
  "KO,NYSE,STOCK,10,58.20,USD,USD,2024-03-15,Example row - replace",
  "TEVA,TASE,STOCK,100,5230,ILS,ILA,2024-05-02,Price in agorot (5230 = 52.30 ILS)",
].join("\n");
