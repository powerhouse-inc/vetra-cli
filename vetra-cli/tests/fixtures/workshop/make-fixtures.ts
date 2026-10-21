/**
 * Regenerates the workshop material fixtures in this folder:
 *   pnpm exec tsx tests/fixtures/workshop/make-fixtures.ts
 * The generated files are committed; this script only documents how.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import ExcelJS from "exceljs";

const dir = import.meta.dirname;

async function checklistXlsx(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "fixture";
  wb.created = new Date(Date.UTC(2026, 0, 1));
  wb.modified = wb.created;
  const ws = wb.addWorksheet("Prüfliste");
  // Row 1: a title merged across the table; row 2 blank; row 3 the header.
  ws.getCell("A1").value = "Prüfliste Brandschutz – Gebäude A";
  ws.mergeCells("A1:G1");
  // Column F stays empty on purpose (no header, no values).
  ws.getRow(3).values = ["Nr", "Prüfpunkt", "Datum", "Status", "Erledigt", null, "Bemerkung"];
  const rows: Array<[number, string, Date, string, string, string]> = [
    [1, "Feuerlöscher geprüft", new Date(Date.UTC(2026, 2, 3)), "i.O.", "ja", ""],
    [2, "Notausgang frei", new Date(Date.UTC(2026, 2, 3)), "n.i.O.", "nein", "Kartons im Flur"],
    [3, "Rauchmelder getestet", new Date(Date.UTC(2026, 2, 4)), "offen", "nein", ""],
    [4, "Fluchtplan aktuell", new Date(Date.UTC(2026, 2, 4)), "i.O.", "ja", ""],
    [5, "Brandschutztür schließt", new Date(Date.UTC(2026, 2, 5)), "offen", "nein", "Nachprüfen"],
    [6, "Sammelplatz markiert", new Date(Date.UTC(2026, 2, 5)), "i.O.", "ja", ""],
  ];
  rows.forEach(([nr, item, date, status, done, note], i) => {
    ws.getRow(4 + i).values = [nr, item, date, status, done, null, note || null];
  });

  const devices = wb.addWorksheet("Geräte");
  devices.getRow(1).values = ["Gerät", "Standort", "Anzahl"];
  devices.getRow(2).values = ["Feuerlöscher", "EG", 4];
  devices.getRow(3).values = ["Rauchmelder", "OG", 12];

  await wb.xlsx.writeFile(join(dir, "checklist.xlsx"));
}

async function headersXlsx(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(Date.UTC(2026, 0, 1));
  wb.modified = wb.created;

  // A two-line header: groups merged over the columns they name.
  const two = wb.addWorksheet("Zwei Zeilen");
  two.getCell("A1").value = "Prüfprotokoll Halle 2";
  two.mergeCells("A1:F1");
  two.getRow(3).values = ["Nr", "Prüfung", null, "Ergebnis", null, "Ort"];
  two.mergeCells("A3:A4");
  two.mergeCells("B3:C3");
  two.mergeCells("D3:E3");
  two.mergeCells("F3:F4");
  two.getCell("B4").value = "Datum";
  two.getCell("C4").value = "Prüfer";
  two.getCell("D4").value = "Status";
  two.getCell("E4").value = "Bemerkung";
  const data: Array<[number, Date, string, string, string, string]> = [
    [1, new Date(Date.UTC(2026, 2, 2)), "MK", "i.O.", "", "Lager"],
    [2, new Date(Date.UTC(2026, 2, 2)), "MK", "n.i.O.", "Tür klemmt", "Lager"],
    [3, new Date(Date.UTC(2026, 2, 3)), "AB", "offen", "", "Büro"],
  ];
  data.forEach((row, i) => (two.getRow(5 + i).values = row));
  // The sub-header repeated further down, as after a printed page break.
  two.getRow(8).values = [null, "Datum", "Prüfer", "Status", "Bemerkung"];
  two.getRow(9).values = [4, new Date(Date.UTC(2026, 2, 4)), "AB", "i.O.", "", "Büro"];

  // A title, then a metadata line, then the real header.
  const meta = wb.addWorksheet("Mit Kopfdaten");
  meta.getCell("A1").value = "Wartungsliste";
  meta.mergeCells("A1:C1");
  meta.getRow(2).values = ["Stand: 01.03.2026", "Prüfer: MK"];
  meta.getRow(3).values = ["Nr", "Punkt", "Status"];
  meta.getRow(4).values = [1, "Filter tauschen", "offen"];
  meta.getRow(5).values = [2, "Riemen prüfen", "erledigt"];
  meta.getRow(6).values = ["Nr", "Punkt", "Status"];
  meta.getRow(7).values = [3, "Öl nachfüllen", "offen"];

  await wb.xlsx.writeFile(join(dir, "headers.xlsx"));
}

function checklistCsv(): void {
  const lines = [
    "Nr;Prüfpunkt;Datum;Status;Bemerkung",
    '1;Feuerlöscher geprüft;03.03.2026;i.O.;"Halle; Nordseite"',
    '2;Notausgang frei;03.03.2026;n.i.O.;"Kartons ""im"" Flur"',
    "3;Rauchmelder getestet;4.3.2026;offen;",
    "4;Fluchtplan aktuell;04.03.2026;i.O.;",
    '5;Brandschutztür schließt;05.03.2026;offen;"zwei\nZeilen"',
    "6;Sammelplatz markiert;05.03.2026;i.O.;",
  ];
  writeFileSync(join(dir, "checklist.csv"), "﻿" + lines.join("\r\n") + "\r\n");
}

function onePagePdf(): void {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // content stream, below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 12 Tf 20 50 Td (Pruefliste) Tj ET";
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(join(dir, "one-page.pdf"), out, "latin1");
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function tinyPng(): void {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // width
  ihdr.writeUInt32BE(2, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(join(dir, "photo.png"), png);
}

await checklistXlsx();
await headersXlsx();
checklistCsv();
onePagePdf();
tinyPng();
