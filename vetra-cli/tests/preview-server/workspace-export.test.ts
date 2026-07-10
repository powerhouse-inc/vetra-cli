import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { unzipSync } from "fflate";

import {
  streamWorkspaceExport,
  WORKSPACE_ZIP_FILENAME,
} from "../../src/preview-server/workspace-export.js";
import { makeWorkdir } from "../spec/_fixtures.js";

// Drain the export stream into a buffer + return the reported file count.
async function collect(workdir: string): Promise<{ buf: Buffer; fileCount: number }> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  const { fileCount } = await streamWorkspaceExport(workdir, sink);
  sink.end();
  return { buf: Buffer.concat(chunks), fileCount };
}

describe("streamWorkspaceExport", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("exposes a stable download filename", () => {
    expect(WORKSPACE_ZIP_FILENAME).toBe("vetra-workspace.zip");
  });

  it("streams a zip of the workdir under workspace/, excluding deps/build/secrets", async () => {
    writeFileSync(join(workdir, "keep.ts"), "export const a = 1;\n");
    writeFileSync(join(workdir, ".env"), "SECRET=1\n");
    writeFileSync(join(workdir, ".env.local"), "SECRET=2\n");
    writeFileSync(join(workdir, ".envrc"), "export SECRET=3\n");
    mkdirSync(join(workdir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(workdir, "node_modules", "pkg", "index.js"), "//\n");
    mkdirSync(join(workdir, "dist"), { recursive: true });
    writeFileSync(join(workdir, "dist", "out.js"), "//\n");
    mkdirSync(join(workdir, ".ph"), { recursive: true });
    writeFileSync(join(workdir, ".ph", ".renown.json"), "{}\n");
    for (const d of ["coverage", ".turbo", ".cache", "build", ".next", "out"]) {
      mkdirSync(join(workdir, d), { recursive: true });
      writeFileSync(join(workdir, d, "x.js"), "//\n");
    }

    const { buf, fileCount } = await collect(workdir);
    const entries = unzipSync(new Uint8Array(buf));
    const names = Object.keys(entries);
    expect(names).toContain("workspace/keep.ts");
    // The fixture stubs a powerhouse.config.json at the workdir root.
    expect(names).toContain("workspace/powerhouse.config.json");
    expect(names).not.toContain("workspace/.env");
    expect(names).not.toContain("workspace/.env.local");
    expect(names).not.toContain("workspace/.envrc");
    for (const d of ["node_modules", "dist", ".ph", "coverage", ".turbo", ".cache", "build", ".next", "out", ".git"]) {
      expect(names.some((n) => n.startsWith(`workspace/${d}/`))).toBe(false);
    }
    expect(fileCount).toBe(names.length);
    expect(fileCount).toBeGreaterThanOrEqual(2);
  });

  it("excludes .git (history/config can carry secrets)", async () => {
    mkdirSync(join(workdir, ".git"), { recursive: true });
    writeFileSync(join(workdir, ".git", "config"), "[core]\n");
    const { buf } = await collect(workdir);
    const names = Object.keys(unzipSync(new Uint8Array(buf)));
    expect(names).not.toContain("workspace/.git/config");
  });

  it("rejects (does not hang or crash) when the output aborts mid-stream", async () => {
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(workdir, `f${i}.ts`), "export const x = " + "0".repeat(500) + ";\n");
    }
    // A sink that destroys itself on the first write, simulating a client that
    // disconnects mid-download. The export must settle by rejecting.
    const sink = new Writable({
      write(_chunk, _enc, cb) {
        this.destroy(new Error("client gone"));
        cb();
      },
    });
    await expect(streamWorkspaceExport(workdir, sink)).rejects.toThrow();
  });

  it("preserves nested paths and round-trips file contents", async () => {
    mkdirSync(join(workdir, "src", "sub"), { recursive: true });
    writeFileSync(join(workdir, "src", "sub", "deep.ts"), "const deep = true;\n");
    const { buf } = await collect(workdir);
    const entries = unzipSync(new Uint8Array(buf));
    expect(Object.keys(entries)).toContain("workspace/src/sub/deep.ts");
    expect(Buffer.from(entries["workspace/src/sub/deep.ts"]).toString("utf8")).toBe(
      "const deep = true;\n",
    );
  });
});
