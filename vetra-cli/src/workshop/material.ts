/**
 * Material a Studio owner brings along (photos, PDFs, sheets, notes), kept
 * under `<workdir>/.ph/vetra/material/<id>/` next to a `meta.json`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { readSheets, type SheetTable } from "./sheets.js";

export type { SheetTable } from "./sheets.js";

export type MaterialKind = "PICTURE" | "PDF" | "SHEET" | "TEXT";

export type MaterialInfo = {
  id: string;
  name: string;
  kind: MaterialKind;
  bytes: number;
  path: string;
  sheets?: SheetTable[];
};

export class UnsupportedMaterialError extends Error {
  constructor(message = "unsupported") {
    super(message);
    this.name = "UnsupportedMaterialError";
  }
}

export function materialDir(workdir: string): string {
  return join(workdir, ".ph", "vetra", "material");
}

function startsWith(head: Buffer, bytes: number[] | string, at = 0): boolean {
  const want = typeof bytes === "string" ? Buffer.from(bytes, "latin1") : Buffer.from(bytes);
  return head.length >= at + want.length && head.subarray(at, at + want.length).equals(want);
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif"]);

function isPicture(head: Buffer): boolean {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true; // PNG
  if (startsWith(head, [0xff, 0xd8, 0xff])) return true; // JPEG
  if (startsWith(head, "GIF87a") || startsWith(head, "GIF89a")) return true;
  if (startsWith(head, "RIFF") && startsWith(head, "WEBP", 8)) return true;
  if (startsWith(head, "ftyp", 4)) {
    return HEIF_BRANDS.has(head.subarray(8, 12).toString("latin1"));
  }
  return false;
}

/** What the material is. Magic bytes win; the name and type only decide for
 * formats without a signature (csv, plain text). Null: not something we take. */
export function materialKindOf(
  fileName: string,
  mimeType: string,
  head: Buffer,
): MaterialKind | null {
  if (isPicture(head)) return "PICTURE";
  if (startsWith(head, "%PDF")) return "PDF";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    // An xlsx is a zip whose entries live under `xl/`; other zips are not ours.
    return head.includes("xl/", 0, "latin1") ? "SHEET" : null;
  }
  const ext = extname(fileName).toLowerCase();
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  if (ext === ".csv" || ext === ".tsv" || mime === "text/csv" || mime === "text/tab-separated-values")
    return "SHEET";
  if (ext === ".txt" || ext === ".md" || mime === "text/plain" || mime === "text/markdown")
    return "TEXT";
  return null;
}

/** A file name that is safe on disk: no path, no control or reserved characters. */
export function safeFileName(fileName: string): string {
  const base = basename(fileName.replace(/\\/g, "/"))
    .normalize("NFC")
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, "_")
    // Format characters (e.g. U+202E right-to-left override) disguise names.
    .replace(/\p{Cf}/gu, "")
    .replace(/^[.\s]+/, "")
    .trim();
  if (base === "" || base === "meta.json") return "material";
  if (base.length <= 120) return base;
  const ext = extname(base).slice(0, 10);
  return base.slice(0, 120 - ext.length) + ext;
}

export async function saveMaterial(
  workdir: string,
  input: { fileName: string; mimeType: string; bytes: Buffer },
): Promise<MaterialInfo> {
  const kind = materialKindOf(input.fileName, input.mimeType, input.bytes);
  if (!kind) throw new UnsupportedMaterialError();

  const id = randomUUID();
  const name = safeFileName(input.fileName);
  const dir = join(materialDir(workdir), id);
  const path = join(dir, name);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path, input.bytes);
    let sheets: SheetTable[] | undefined;
    if (kind === "SHEET") {
      try {
        sheets = await readSheets(path);
      } catch {
        throw new UnsupportedMaterialError("unsupported: unreadable sheet");
      }
    }
    const info: MaterialInfo = { id, name, kind, bytes: input.bytes.length, path, ...(sheets && { sheets }) };
    const meta = { ...info, path: undefined, mimeType: input.mimeType, savedAt: new Date().toISOString() };
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
    return info;
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
