/**
 * Minimal RFC 4180 CSV reader (pure, no dependencies): quoted fields,
 * escaped quotes, CRLF/LF, a UTF-8 BOM, and comma / semicolon / tab
 * delimiters (detected from the header line).
 */

export interface CsvTable {
  delimiter: string;
  header: string[];
  /** Data rows with their 1-based line number in the file. */
  rows: { line: number; cells: string[] }[];
}

export class CsvError extends Error {
  constructor(
    public readonly code: "EMPTY" | "UNTERMINATED_QUOTE" | "TOO_MANY_ROWS" | "TOO_LARGE",
    message: string,
    public readonly line?: number,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

export const CSV_LIMITS = { maxRows: 2000, maxBytes: 1_000_000 };

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => {
    let n = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) n++;
    }
    return [d, n] as const;
  });
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(text: string): CsvTable {
  if (text.length > CSV_LIMITS.maxBytes) throw new CsvError("TOO_LARGE", `File is larger than ${CSV_LIMITS.maxBytes} bytes.`);
  const src = text.replace(/^﻿/, "");
  if (!src.trim()) throw new CsvError("EMPTY", "The file is empty.");
  const firstLine = src.split(/\r?\n/, 1)[0];
  const delimiter = detectDelimiter(firstLine);

  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      cells.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      cells.push(field);
      records.push({ line: recordLine, cells });
      cells = [];
      field = "";
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (quoted) throw new CsvError("UNTERMINATED_QUOTE", "A quoted field is not closed.", recordLine);
  if (field !== "" || cells.length) {
    cells.push(field);
    records.push({ line: recordLine, cells });
  }
  const nonEmpty = records.filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) throw new CsvError("EMPTY", "The file is empty.");
  const [head, ...rows] = nonEmpty;
  if (rows.length > CSV_LIMITS.maxRows) throw new CsvError("TOO_MANY_ROWS", `More than ${CSV_LIMITS.maxRows} rows.`);
  return { delimiter, header: head.cells.map((c) => c.trim()), rows };
}
