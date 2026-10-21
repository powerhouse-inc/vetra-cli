/**
 * Reading a sheet someone brought along (xlsx or csv) into plain tables:
 * find the header row under any title rows, drop blank rows and empty
 * columns, and guess what each column holds.
 */
import { open, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import ExcelJS from "exceljs";

export type ColumnType = "text" | "number" | "date" | "yes-no" | "choice";

export type SheetTable = {
  sheet: string;
  header: string[];
  types: ColumnType[];
  /** All data rows as display strings, one entry per header column. */
  rows: string[][];
  rowCount: number;
};

/** One grid cell: its display text, and whether it is the covered part of a
 * merge (counted once when looking for the header). */
type Cell = { text: string; covered?: boolean };

const CHOICE_MAX_DISTINCT = 8;
const CHOICE_MIN_ROWS = 5;

/* ------------------------------------------------------------------ csv */

// Ties go to the earlier one: commas also turn up inside plain text.
const SEPARATORS = ["\t", ";", ","] as const;

/** Count `sep` outside quotes on each of the first lines. */
function separatorCounts(text: string, sep: string, maxLines = 10): number[] {
  const counts: number[] = [];
  let n = 0;
  let quoted = false;
  for (let i = 0; i < text.length && counts.length < maxLines; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === sep) n++;
    else if (!quoted && ch === "\n") {
      counts.push(n);
      n = 0;
    }
  }
  if (counts.length < maxLines && n > 0) counts.push(n);
  return counts;
}

function sniffSeparator(text: string): string {
  let best: string = ",";
  let bestScore = 0;
  for (const sep of SEPARATORS) {
    const counts = separatorCounts(text, sep);
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    // Lines agreeing with the first line's count, weighted by that count.
    const agree = counts.filter((c) => c === first).length;
    const score = agree * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

/** RFC 4180 CSV: BOM stripped, separator sniffed among `,` `;` and tab. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sep = sniffSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      // CRLF: the \n ends the row.
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
    i++;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** UTF-8 when valid, else Windows-1252 (what Excel writes on German Windows). */
function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/* ----------------------------------------------------------------- xlsx */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return h || m ? `${day} ${pad2(h)}:${pad2(m)}` : day;
}

function displayValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(Number(value.toPrecision(15)));
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return formatDate(value);
  if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
  if ("hyperlink" in value) return displayValue(value.text);
  if ("error" in value) return value.error;
  if ("result" in value) return displayValue(value.result);
  return "";
}

function worksheetGrid(ws: ExcelJS.Worksheet): Cell[][] {
  const grid: Cell[][] = [];
  const cols = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Cell[] = [];
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      // A merged cell's covered part reads as its top-left cell.
      const master = cell.isMerged ? cell.master : cell;
      const covered = master !== cell;
      cells.push({ text: displayValue(master.value), covered });
    }
    grid.push(cells);
  }
  return grid;
}

/* ------------------------------------------------------------- tables */

const NUMBER = /^[+-]?(?:\d+|\d{1,3}(?:[., ' ]\d{3})+)(?:[.,]\d+)?\s*%?$/;
const CURRENCY = /^[€$£]\s*|\s*(?:€|\$|£|EUR|USD|CHF)$/i;
const DATE_DE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;
const DATE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?$/;
const DATE_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isNumber(s: string): boolean {
  return NUMBER.test(s.replace(CURRENCY, ""));
}

function validDay(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function isDate(s: string): boolean {
  let m = DATE_DE.exec(s);
  if (m) return validDay(Number(m[1]), Number(m[2]));
  m = DATE_ISO.exec(s);
  if (m) return validDay(Number(m[3]), Number(m[2]));
  m = DATE_SLASH.exec(s);
  if (m) return validDay(Number(m[1]), Number(m[2])) || validDay(Number(m[2]), Number(m[1]));
  return false;
}

/** Values that read as one side of a yes/no mark (lower-cased). */
const YES_NO = new Set([
  "ja", "nein", "j", "n", "yes", "no", "y",
  "x", "✓", "✔", "✗", "✘",
  "i.o.", "n.i.o.", "io", "nio", "i.o", "n.i.o",
  "ok", "nok", "true", "false", "wahr", "falsch",
]);

function columnType(values: string[]): ColumnType {
  const filled = values.filter((v) => v !== "");
  if (filled.length === 0) return "text";
  const distinct = new Set(filled.map((v) => v.toLowerCase()));
  if (distinct.size <= 2 && [...distinct].every((v) => YES_NO.has(v))) return "yes-no";
  if (filled.every(isDate)) return "date";
  if (filled.every(isNumber)) return "number";
  // A choice repeats its values: a column of all-different labels is text.
  if (
    filled.length >= CHOICE_MIN_ROWS &&
    distinct.size <= CHOICE_MAX_DISTINCT &&
    distinct.size * 2 <= filled.length
  )
    return "choice";
  return "text";
}

/** First row with ≥ 2 text cells and at most one numeric cell. */
function findHeaderRow(grid: Cell[][]): number {
  return grid.findIndex((row) => {
    const own = row.filter((c) => !c.covered && c.text !== "");
    const numeric = own.filter((c) => isNumber(c.text)).length;
    const text = own.filter((c) => !isNumber(c.text) && !isDate(c.text)).length;
    return text >= 2 && numeric <= 1;
  });
}

function columnLetter(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

function toTable(sheet: string, grid: Cell[][]): SheetTable {
  const isBlank = (row: Cell[]) => row.every((c) => c.text === "");
  const headerAt = findHeaderRow(grid);
  const headerRow = headerAt === -1 ? [] : grid[headerAt].map((c) => c.text);
  const dataRows = grid
    .slice(headerAt + 1)
    .filter((row) => !isBlank(row))
    .map((row) => row.map((c) => c.text));
  const width = Math.max(headerRow.length, ...dataRows.map((r) => r.length), 0);

  const keep: number[] = [];
  for (let c = 0; c < width; c++) {
    if ((headerRow[c] ?? "") !== "" || dataRows.some((r) => (r[c] ?? "") !== "")) keep.push(c);
  }

  const seen = new Map<string, number>();
  const header = keep.map((c) => {
    const name = headerRow[c] || columnLetter(c);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  });
  const rows = dataRows.map((r) => keep.map((c) => r[c] ?? ""));
  const types = keep.map((_, i) => columnType(rows.map((r) => r[i])));
  return { sheet, header, types, rows, rowCount: rows.length };
}

async function isZip(path: string): Promise<boolean> {
  const fh = await open(path, "r");
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await fh.read(head, 0, 4, 0);
    return bytesRead === 4 && head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  } finally {
    await fh.close();
  }
}

/** Every sheet of an xlsx workbook, or the one table of a csv file. */
export async function readSheets(path: string): Promise<SheetTable[]> {
  if (await isZip(path)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    return wb.worksheets.map((ws) => toTable(ws.name, worksheetGrid(ws)));
  }
  const text = decodeText(await readFile(path));
  const grid = parseCsv(text).map((row) => row.map((v) => ({ text: v.trim() })));
  return [toTable(basename(path, extname(path)), grid)];
}
