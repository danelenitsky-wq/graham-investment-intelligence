import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "@/lib/portfolio/import/csv";
import { extractCsv, IMPORT_TEMPLATE_CSV, pdfStatementExtractor } from "@/lib/portfolio/import/sources";
import { canonicalExchange, hasErrors, mergeDrafts, parseDecimal, validateHoldingRow, validateHoldingRows, type RawHoldingRow } from "@/lib/portfolio/import/validate";

const today = "2026-11-06";
const row = (fields: RawHoldingRow["fields"], line = 2): RawHoldingRow => ({
  line,
  fields: { ticker: "KO", exchange: "NYSE", securityType: "STOCK", quantity: "10", averagePrice: "58.2", currency: "USD", ...fields },
});
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe("CSV parser", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and semicolons", () => {
    const t = parseCsv('﻿a;b;c\r\n1;"x;y";"say ""hi"""\r\n\r\n2;;3\n');
    expect(t.delimiter).toBe(";");
    expect(t.header).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([
      { line: 2, cells: ["1", "x;y", 'say "hi"'] },
      { line: 4, cells: ["2", "", "3"] },
    ]);
  });

  it("reports empty files and unterminated quotes", () => {
    expect(() => parseCsv("  \n")).toThrow(CsvError);
    try {
      parseCsv('a,b\n1,"open');
    } catch (e) {
      expect((e as CsvError).code).toBe("UNTERMINATED_QUOTE");
    }
  });
});

describe("CSV extraction", () => {
  it("maps English and Hebrew headers and reports missing columns", () => {
    const x = extractCsv("Symbol,Exchange,Type,Shares,Avg Price,Currency,Extra\nKO,NYSE,STOCK,10,58.2,USD,x");
    expect(x.missingColumns).toEqual([]);
    expect(x.unmappedColumns).toEqual(["Extra"]);
    expect(x.rows[0].fields).toMatchObject({ ticker: "KO", quantity: "10", averagePrice: "58.2" });
    const missing = extractCsv("ticker,quantity\nKO,1");
    expect(missing.missingColumns.length).toBeGreaterThan(0);
  });

  it("parses the downloadable template without errors", () => {
    const x = extractCsv(IMPORT_TEMPLATE_CSV);
    const v = validateHoldingRows(x.rows, today);
    expect(v.every((r) => !hasErrors(r))).toBe(true);
    expect(v[1].draft).toMatchObject({ exchange: "TASE", currency: "ILS", priceUnit: "ILA", enteredPrice: 5230, averagePrice: 52.3 });
  });

  it("has a PDF extractor placeholder that saves nothing", async () => {
    const r = await pdfStatementExtractor.extract({ fileName: "statement.pdf", bytes: new Uint8Array([1]) });
    expect(r.rows).toEqual([]);
    expect(r.errors[0].code).toBe("NOT_IMPLEMENTED");
  });
});

describe("holding validation", () => {
  it("accepts a valid US row", () => {
    const r = validateHoldingRow(row({ purchaseDate: "2024-03-15" }), today);
    expect(r.issues).toEqual([]);
    expect(r.draft).toMatchObject({ ticker: "KO", exchange: "NYSE", market: "US", currency: "USD", priceUnit: "USD", averagePrice: 58.2, purchaseDate: "2024-03-15" });
  });

  it("requires an explicit unit for Israeli prices and converts agorot", () => {
    const base = { ticker: "TEVA", exchange: "TASE", currency: "ILS", averagePrice: "5230", quantity: "100" };
    expect(codes(validateHoldingRow(row(base), today))).toContain("PRICE_UNIT_REQUIRED");
    expect(validateHoldingRow(row({ ...base, priceUnit: "agorot" }), today).draft?.averagePrice).toBe(52.3);
    expect(validateHoldingRow(row({ ...base, priceUnit: "ILS", averagePrice: "52.30" }), today).draft?.averagePrice).toBe(52.3);
    expect(validateHoldingRow(row({ ...base, currency: "ILA" }), today).draft).toMatchObject({ priceUnit: "ILA", averagePrice: 52.3 });
    expect(codes(validateHoldingRow(row({ ...base, currency: "ILA", priceUnit: "ILS" }), today))).toContain("PRICE_UNIT_CURRENCY_MISMATCH");
  });

  it("rejects a currency that is not the exchange's trading currency", () => {
    expect(codes(validateHoldingRow(row({ currency: "ILS", priceUnit: "ILS" }), today))).toContain("CURRENCY_EXCHANGE_MISMATCH");
    expect(codes(validateHoldingRow(row({ exchange: "TASE", ticker: "TEVA", currency: "USD" }), today))).toContain("CURRENCY_EXCHANGE_MISMATCH");
    expect(codes(validateHoldingRow(row({ currency: "EUR" }), today))).toContain("UNKNOWN_CURRENCY");
    expect(codes(validateHoldingRow(row({ priceUnit: "ILA" }), today))).toContain("PRICE_UNIT_CURRENCY_MISMATCH");
  });

  it("checks symbols, exchanges, types, quantities, prices and dates", () => {
    expect(codes(validateHoldingRow(row({ ticker: "TOOLONG" }), today))).toContain("INVALID_SYMBOL");
    expect(codes(validateHoldingRow(row({ exchange: "LSE" }), today))).toContain("UNKNOWN_EXCHANGE");
    expect(codes(validateHoldingRow(row({ securityType: "BOND" }), today))).toContain("UNKNOWN_SECURITY_TYPE");
    expect(codes(validateHoldingRow(row({ quantity: "-5" }), today))).toContain("NOT_POSITIVE");
    expect(codes(validateHoldingRow(row({ quantity: "1.234,5" }), today))).toContain("INVALID_NUMBER");
    expect(codes(validateHoldingRow(row({ averagePrice: "0" }), today))).toContain("NOT_POSITIVE");
    expect(codes(validateHoldingRow(row({ averagePrice: "1.1234567" }), today))).toContain("TOO_MANY_DECIMALS");
    expect(codes(validateHoldingRow(row({ purchaseDate: "15/03/2024" }), today))).toContain("DATE_FORMAT");
    expect(codes(validateHoldingRow(row({ purchaseDate: "2024-02-30" }), today))).toContain("DATE_FORMAT");
    expect(codes(validateHoldingRow(row({ purchaseDate: "2026-11-07" }), today))).toContain("DATE_IN_FUTURE");
    expect(codes(validateHoldingRow(row({ taseSecurityNumber: "629014" }), today))).toContain("INVALID_SECURITY_NUMBER");
    expect(codes(validateHoldingRow(row({ ticker: "TEVA", exchange: "TASE", currency: "ILS", priceUnit: "ILS", quantity: "1.5" }), today))).toContain("FRACTIONAL_QUANTITY");
    expect(validateHoldingRow(row({ quantity: "" }), today).draft).toBeNull();
  });

  it("parses decimals strictly", () => {
    expect(parseDecimal("1,234.5")).toBe(1234.5);
    expect(parseDecimal(" 12 ")).toBe(12);
    expect(parseDecimal("1e3")).toBeNaN();
    expect(parseDecimal("")).toBeNull();
    expect(canonicalExchange("tlv")).toBe("TASE");
    expect(canonicalExchange("NYSE Arca")).toBe("NYSEARCA");
  });

  it("merges duplicate rows of one security with a warning and a weighted average", () => {
    const rows = validateHoldingRows(
      [
        row({ ticker: "TEVA", exchange: "TASE", currency: "ILS", priceUnit: "ILA", quantity: "100", averagePrice: "5000", purchaseDate: "2024-05-02" }, 2),
        row({ ticker: "TEVA", exchange: "TASE", currency: "ILS", priceUnit: "ILS", quantity: "300", averagePrice: "60", purchaseDate: "2023-01-10" }, 3),
      ],
      today,
    );
    expect(rows.every((r) => codes(r).includes("DUPLICATE_MERGED") && !hasErrors(r))).toBe(true);
    const [m] = mergeDrafts(rows);
    expect(m).toMatchObject({ quantity: 400, purchaseDate: "2023-01-10", lines: [2, 3] });
    expect(m.averagePrice).toBeCloseTo((100 * 50 + 300 * 60) / 400, 12);
    expect(m.enteredPrice).toBeCloseTo((100 * 5000 + 300 * 6000) / 400, 9);
  });
});
