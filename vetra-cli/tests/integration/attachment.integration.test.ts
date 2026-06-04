import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely-pglite-dialect";
import {
  AttachmentBuilder,
  type IAttachmentService,
} from "@powerhousedao/reactor-attachments";
import { attachmentPreprocess } from "../../src/commands/attachment/preprocess.js";
import { attachmentUpload } from "../../src/commands/attachment/upload.js";
import { attachmentStat } from "../../src/commands/attachment/stat.js";
import { attachmentGet } from "../../src/commands/attachment/get.js";

type ExecCtx = Parameters<typeof attachmentUpload.execute>[1];

// Reactor-bearing context whose .attachments is the real local service.
function makeReactorCtx(workdir: string, attachments?: IAttachmentService): ExecCtx {
  return {
    workdir,
    folders: {},
    config: {},
    stdout: () => {},
    reactor: async () => (attachments ? { attachments } : undefined),
  } as unknown as ExecCtx;
}

// Parse the commands' `key: value\n` text output into a map.
function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const CONTENT = "hello attachment world";
const EXPECTED_HASH = createHash("sha256").update(Buffer.from(CONTENT)).digest("hex");
const EXPECTED_REF = `attachment://v1:${EXPECTED_HASH}`;
const REF_RE = /^attachment:\/\/v1:[0-9a-f]{64}$/;

describe("attachment-* commands (local service, end-to-end)", () => {
  let db: Kysely<unknown>;
  let service: IAttachmentService;
  let destroyService: () => void;
  let workdir: string;
  let storagePath: string;
  let ctx: ExecCtx;
  let filePath: string;

  beforeAll(async () => {
    db = new Kysely<unknown>({ dialect: new PGliteDialect(new PGlite()) });
    storagePath = mkdtempSync(join(tmpdir(), "attach-store-"));
    const built = await new AttachmentBuilder(db, storagePath).build();
    service = built.service;
    destroyService = built.destroy;

    workdir = mkdtempSync(join(tmpdir(), "attach-wd-"));
    filePath = join(workdir, "note.txt");
    writeFileSync(filePath, CONTENT);
    ctx = makeReactorCtx(workdir, service);
  });

  afterAll(async () => {
    destroyService?.();
    await db?.destroy();
    rmSync(storagePath, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
  });

  it("preprocess yields the deterministic ref WITHOUT uploading", async () => {
    const { text } = await attachmentPreprocess.execute({ filePath }, ctx);
    const out = parse(text);
    expect(out.ref).toBe(EXPECTED_REF);
    expect(out.ref).toMatch(REF_RE);
    expect(out.hash).toBe(EXPECTED_HASH);
    expect(out.sizeBytes).toBe(String(Buffer.byteLength(CONTENT)));
    expect(out.mimeType).toBe("text/plain");
    // Not uploaded: the service has no record of it yet.
    await expect(service.stat(EXPECTED_REF as never)).rejects.toThrow();
  });

  it("upload stores the bytes and returns the same ref (available)", async () => {
    const { text } = await attachmentUpload.execute({ filePath }, ctx);
    const out = parse(text);
    expect(out.ref).toBe(EXPECTED_REF);
    expect(out.hash).toBe(EXPECTED_HASH);
    expect(out.status).toBe("available");
    expect(out.fileName).toBe("note.txt");
  });

  it("stat reports available metadata for an uploaded ref", async () => {
    const { text } = await attachmentStat.execute({ ref: EXPECTED_REF }, ctx);
    const out = parse(text);
    expect(out.status).toBe("available");
    expect(out.sizeBytes).toBe(String(Buffer.byteLength(CONTENT)));
    expect(out.mimeType).toBe("text/plain");
    expect(out.fileName).toBe("note.txt");
  });

  it("get streams the stored bytes back to disk byte-for-byte", async () => {
    const outPath = join(workdir, "roundtrip.txt");
    const { text } = await attachmentGet.execute({ ref: EXPECTED_REF, outPath }, ctx);
    expect(text).toMatch(/Wrote \d+ bytes/);
    expect(readFileSync(outPath, "utf8")).toBe(CONTENT);
  });

  it("re-uploading identical bytes dedups to the same ref without error", async () => {
    const { text } = await attachmentUpload.execute({ filePath }, ctx);
    const out = parse(text);
    expect(out.ref).toBe(EXPECTED_REF);
    expect(out.status).toBe("available");
  });

  it("different bytes produce a different ref", async () => {
    const otherPath = join(workdir, "other.txt");
    writeFileSync(otherPath, "a completely different payload");
    const { text } = await attachmentPreprocess.execute({ filePath: otherPath }, ctx);
    const out = parse(text);
    expect(out.ref).toMatch(REF_RE);
    expect(out.ref).not.toBe(EXPECTED_REF);
  });

  it("stat on an unknown ref reports not-found rather than throwing", async () => {
    const unknown = `attachment://v1:${"0".repeat(64)}`;
    const { text } = await attachmentStat.execute({ ref: unknown }, ctx);
    expect(text).toMatch(/Not found or error/);
  });

  it("returns the unavailable message when no reactor is wired (one-shot)", async () => {
    const bare = makeReactorCtx(workdir, undefined);
    const { text } = await attachmentUpload.execute({ filePath }, bare);
    expect(text).toMatch(/running reactor/);
  });
});
