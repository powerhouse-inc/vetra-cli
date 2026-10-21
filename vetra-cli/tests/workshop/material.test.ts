import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { materialKindOf, saveMaterial } from "../../src/workshop/material.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "workshop");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

describe("materialKindOf", () => {
  it("kind comes from the bytes, not the extension", () => {
    expect(materialKindOf("list.csv", "text/csv", fixture("photo.png"))).toBe("PICTURE");
    expect(materialKindOf("photo.png", "image/png", fixture("one-page.pdf"))).toBe("PDF");
    expect(materialKindOf("notes.txt", "text/plain", fixture("checklist.xlsx"))).toBe("SHEET");
    expect(materialKindOf("photo.png", "image/png", Buffer.from("just text"))).toBeNull();
  });

  it("recognises the picture formats", () => {
    expect(materialKindOf("a", "", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("PICTURE");
    expect(materialKindOf("a", "", Buffer.from("GIF89a......"))).toBe("PICTURE");
    expect(materialKindOf("a", "", Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("PICTURE");
    expect(materialKindOf("a", "", Buffer.from("\0\0\0\x18ftypheic\0\0\0\0"))).toBe("PICTURE");
  });

  it("falls back to the name and type for text formats", () => {
    expect(materialKindOf("Liste.CSV", "", Buffer.from("a;b"))).toBe("SHEET");
    expect(materialKindOf("export", "text/csv", Buffer.from("a;b"))).toBe("SHEET");
    expect(materialKindOf("notes.md", "", Buffer.from("# Notes"))).toBe("TEXT");
    expect(materialKindOf("notes.txt", "", Buffer.from("hi"))).toBe("TEXT");
    expect(materialKindOf("archive.zip", "application/zip", Buffer.from("PK\x03\x04word/doc"))).toBeNull();
    expect(materialKindOf("unknown.bin", "application/octet-stream", Buffer.from([1, 2, 3]))).toBeNull();
  });
});

describe("saveMaterial", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("stores the file with its meta and reads sheets", async () => {
    const info = await saveMaterial(workdir, {
      fileName: "../Prüfliste März.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: fixture("checklist.xlsx"),
    });
    expect(info.kind).toBe("SHEET");
    expect(info.name).toBe("Prüfliste März.xlsx");
    expect(info.path).toBe(join(workdir, ".ph", "vetra", "material", info.id, "Prüfliste März.xlsx"));
    expect(readFileSync(info.path).equals(fixture("checklist.xlsx"))).toBe(true);
    expect(info.sheets?.map((s) => s.sheet)).toEqual(["Prüfliste", "Geräte"]);
    const meta = JSON.parse(readFileSync(join(workdir, ".ph/vetra/material", info.id, "meta.json"), "utf8"));
    expect(meta).toMatchObject({ id: info.id, name: info.name, kind: "SHEET", bytes: info.bytes });
  });

  it("stores a picture without sheets", async () => {
    const info = await saveMaterial(workdir, {
      fileName: "photo.png",
      mimeType: "image/png",
      bytes: fixture("photo.png"),
    });
    expect(info).toMatchObject({ kind: "PICTURE", name: "photo.png", bytes: 77 });
    expect(info.sheets).toBeUndefined();
  });

  it("refuses an unknown type and stores nothing", async () => {
    await expect(
      saveMaterial(workdir, { fileName: "x.bin", mimeType: "", bytes: Buffer.from([1]) }),
    ).rejects.toThrow("unsupported");
    expect(existsSync(join(workdir, ".ph/vetra/material"))).toBe(false);
  });
});
