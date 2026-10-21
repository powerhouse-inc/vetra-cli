import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@jest/globals";
import ExcelJS from "exceljs";

import { parseCsv, readSheets, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from "../../src/workshop/sheets.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "workshop");
const scratch = mkdtempSync(join(tmpdir(), "vetra-sheets-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("readSheets (xlsx)", () => {
  it("title row and blank rows before the header are skipped", async () => {
    const [table] = await readSheets(join(FIXTURES, "checklist.xlsx"));
    expect(table.sheet).toBe("Prüfliste");
    expect(table.header).toEqual(["Nr", "Prüfpunkt", "Datum", "Status", "Erledigt", "Bemerkung"]);
    expect(table.rowCount).toBe(6);
    expect(table.rows).toHaveLength(6);
    expect(table.rows[0]).toEqual(["1", "Feuerlöscher geprüft", "2026-03-03", "i.O.", "ja", ""]);
    expect(table.rows[1][5]).toBe("Kartons im Flur");
  });

  it("merged title cell does not become a column", async () => {
    const [table] = await readSheets(join(FIXTURES, "checklist.xlsx"));
    for (const row of table.rows) expect(row).not.toContain("Prüfliste Brandschutz – Gebäude A");
    expect(table.header).not.toContain("Prüfliste Brandschutz – Gebäude A");
  });

  it("merged cells in the data take the top-left value", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Räume");
    ws.getRow(1).values = ["Bereich", "Raum"];
    ws.getRow(2).values = ["Halle", "R1"];
    ws.getRow(3).values = [null, "R2"];
    ws.mergeCells("A2:A3");
    const file = join(scratch, "merged.xlsx");
    await wb.xlsx.writeFile(file);
    const [table] = await readSheets(file);
    expect(table.rows).toEqual([
      ["Halle", "R1"],
      ["Halle", "R2"],
    ]);
  });

  it("empty columns are dropped", async () => {
    const [table] = await readSheets(join(FIXTURES, "checklist.xlsx"));
    expect(table.header).toHaveLength(6);
    for (const row of table.rows) expect(row).toHaveLength(6);
  });

  it("status column of offen / i.O. / n.i.O. is a choice", async () => {
    const [table] = await readSheets(join(FIXTURES, "checklist.xlsx"));
    expect(table.types).toEqual(["number", "text", "date", "choice", "yes-no", "text"]);
  });

  it("reads every sheet", async () => {
    const tables = await readSheets(join(FIXTURES, "checklist.xlsx"));
    expect(tables.map((t) => t.sheet)).toEqual(["Prüfliste", "Geräte"]);
    expect(tables[1]).toMatchObject({
      header: ["Gerät", "Standort", "Anzahl"],
      types: ["text", "text", "number"],
      rowCount: 2,
    });
  });
});

describe("readSheets (header shapes)", () => {
  it("a two-line header with merged groups becomes one combined header", async () => {
    const [table] = await readSheets(join(FIXTURES, "headers.xlsx"));
    expect(table.sheet).toBe("Zwei Zeilen");
    expect(table.header).toEqual([
      "Nr",
      "Prüfung – Datum",
      "Prüfung – Prüfer",
      "Ergebnis – Status",
      "Ergebnis – Bemerkung",
      "Ort",
    ]);
    expect(table.types).toEqual(["number", "date", "text", "text", "text", "text"]);
    expect(table.rowCount).toBe(4);
    expect(table.rows[0]).toEqual(["1", "2026-03-02", "MK", "i.O.", "", "Lager"]);
  });

  it("a data row that repeats the header is dropped", async () => {
    const tables = await readSheets(join(FIXTURES, "headers.xlsx"));
    expect(tables[0].rows.map((r) => r[0])).toEqual(["1", "2", "3", "4"]);
    expect(tables[1].rows.map((r) => r[0])).toEqual(["1", "2", "3"]);
  });

  it("a metadata line above the header is not the header", async () => {
    const [, table] = await readSheets(join(FIXTURES, "headers.xlsx"));
    expect(table.sheet).toBe("Mit Kopfdaten");
    expect(table.header).toEqual(["Nr", "Punkt", "Status"]);
    expect(table.rowCount).toBe(3);
  });

  it("a metadata line with keys in their own cells is not the header", async () => {
    const file = join(scratch, "keys.csv");
    writeFileSync(file, "Stand:;01.03.2026;Prüfer:;MK\n\nNr;Punkt;Status\n1;Filter;offen\n");
    const [table] = await readSheets(file);
    expect(table.header).toEqual(["Nr", "Punkt", "Status"]);
    expect(table.rows).toEqual([["1", "Filter", "offen"]]);
  });

  it("a one-line header with a merged cell keeps data rows as data", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Notizen");
    ws.getRow(1).values = ["Punkt", "Notiz"];
    ws.mergeCells("B1:C1");
    ws.getRow(2).values = ["Tür", "klemmt", "oben"];
    ws.getRow(3).values = ["Fenster", "ok", ""];
    const file = join(scratch, "one-line.xlsx");
    await wb.xlsx.writeFile(file);
    const [table] = await readSheets(file);
    expect(table.header).toEqual(["Punkt", "Notiz", "Notiz 2"]);
    expect(table.rowCount).toBe(2);
  });

  it("a huge sheet is read up to the row and column caps", async () => {
    const header = Array.from({ length: SHEET_MAX_COLUMNS + 20 }, (_, i) => `K${i}`);
    const lines = [header.join(";")];
    for (let r = 0; r < SHEET_MAX_ROWS + 100; r++) lines.push(header.map(() => "v").join(";"));
    const file = join(scratch, "huge.csv");
    writeFileSync(file, lines.join("\n"));
    const [table] = await readSheets(file);
    expect(table.header).toHaveLength(SHEET_MAX_COLUMNS);
    expect(table.rowCount).toBe(SHEET_MAX_ROWS);
  });
});

describe("readSheets (csv)", () => {
  it("German dates are dates", async () => {
    const [table] = await readSheets(join(FIXTURES, "checklist.csv"));
    expect(table.header[2]).toBe("Datum");
    expect(table.types[2]).toBe("date");
    expect(table.rows[2][2]).toBe("4.3.2026");
  });

  it("semicolon CSV with BOM", async () => {
    const [table] = await readSheets(join(FIXTURES, "checklist.csv"));
    expect(table.sheet).toBe("checklist");
    expect(table.header).toEqual(["Nr", "Prüfpunkt", "Datum", "Status", "Bemerkung"]);
    expect(table.types).toEqual(["number", "text", "date", "choice", "text"]);
    expect(table.rowCount).toBe(6);
  });

  it("a Windows-1252 CSV keeps its umlauts", async () => {
    const file = join(scratch, "ansi.csv");
    writeFileSync(file, Buffer.from("Prüfpunkt;Größe\nTür;groß\n", "latin1"));
    const [table] = await readSheets(file);
    expect(table.header).toEqual(["Prüfpunkt", "Größe"]);
    expect(table.rows).toEqual([["Tür", "groß"]]);
  });

  it("infers yes-no for x / ✓ style columns", async () => {
    const file = join(scratch, "marks.csv");
    writeFileSync(file, "Punkt,Erledigt\nA,x\nB,\nC,x\nD,\nE,x\n");
    const [table] = await readSheets(file);
    expect(table.types).toEqual(["text", "yes-no"]);
  });
});

describe("parseCsv", () => {
  it("quoted separators stay in the cell", () => {
    expect(parseCsv('a;b\n1;"x; y"\n2;"say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["1", "x; y"],
      ["2", 'say "hi"'],
    ]);
  });

  it("keeps newlines inside quotes and handles CRLF", () => {
    expect(parseCsv('a,b\r\n"one\r\ntwo",3\r\n')).toEqual([
      ["a", "b"],
      ["one\r\ntwo", "3"],
    ]);
  });

  it("strips the BOM and sniffs tabs", () => {
    expect(parseCsv("﻿a\tb, c\n1\t2, 3")).toEqual([
      ["a", "b, c"],
      ["1", "2, 3"],
    ]);
  });

  it("defaults to commas", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
