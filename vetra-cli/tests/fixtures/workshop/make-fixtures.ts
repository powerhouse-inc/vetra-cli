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
checklistCsv();
onePagePdf();
tinyPng();
