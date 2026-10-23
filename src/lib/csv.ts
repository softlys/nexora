/**
 * CSV writing and reading for exports and imports (RFC 4180: comma-separated, CRLF lines,
 * quotes doubled inside quoted fields).
 */

/**
 * Cells that start with = + - @ (or a tab / carriage return) are run as formulas by Excel and
 * Google Sheets ("CSV injection"). They are prefixed with an apostrophe so they open as text.
 */
function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = neutralize(Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A UTF-8 BOM first, so Excel opens non-Latin text (Cyrillic, accents) correctly. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Parses CSV text into rows of cells. Accepts comma or semicolon separators (Excel in many locales uses ;). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}
