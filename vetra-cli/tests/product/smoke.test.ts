import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { runSmoke } from "../../src/product/smoke.js";

/** A stand-in for the preview's Vite: serves module paths, or an error page. */
function viteLike(errors: Record<string, string>): Promise<{ url: string; seen: string[]; close: () => Promise<void> }> {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    const p = (req.url ?? "").replace(/^\/preview\//, "");
    seen.push(p);
    if (errors[p]) {
      res.statusCode = 500;
      const error = JSON.stringify({ message: errors[p], plugin: "vite:esbuild" });
      res.end(`<!DOCTYPE html><html><head><title>Error</title><script type="module">const error = ${error}; const { ErrorOverlay } = await import("/@vite/client");</script></head></html>`);
      return;
    }
    res.setHeader("content-type", "text/javascript");
    res.end("export default {};");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/preview`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("runSmoke", () => {
  let project: string;
  const builds: string[] = [];
  const okBuild = async (p: string) => {
    builds.push(p);
    return { success: true, output: "built" };
  };

  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-"));
    for (const f of [
      "editors/todo-editor/editor.tsx",
      "editors/todo-editor/module.ts",
      "editors/todo-editor/editor.test.tsx",
      "apps/board/index.ts",
    ]) {
      await fs.mkdir(path.dirname(path.join(project, f)), { recursive: true });
      await fs.writeFile(path.join(project, f), "export {};");
    }
    builds.length = 0;
  });
  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });

  it("smoke fails when the preview server returns a transform error for an editor module", async () => {
    const vite = await viteLike({
      "editors/todo-editor/editor.tsx": "Transform failed with 1 error:\nexpected \";\" but found \"x\"",
    });
    try {
      const result = await runSmoke(project, { previewUrl: vite.url, build: okBuild });
      expect(result).toEqual({
        kind: "SMOKE",
        passed: false,
        reason: "A screen didn't load: editors/todo-editor/editor.tsx.",
        // Vite's own message is for the agent only.
        detail: "The preview could not load: editors/todo-editor/editor.tsx: Transform failed with 1 error:",
      });
    } finally {
      await vite.close();
    }
  });

  it("smoke passes when the package builds and every editor module serves 200", async () => {
    const vite = await viteLike({});
    try {
      const result = await runSmoke(project, { previewUrl: vite.url, build: okBuild });
      expect(result).toEqual({ kind: "SMOKE", passed: true, reason: null });
      expect(builds).toEqual([project]);
      // Every editor/app source module is requested; tests are not.
      expect(vite.seen.sort()).toEqual([
        "apps/board/index.ts",
        "editors/todo-editor/editor.tsx",
        "editors/todo-editor/module.ts",
      ]);
    } finally {
      await vite.close();
    }
  });

  it("fails when the build fails, or when the preview is not running", async () => {
    const failed = await runSmoke(project, {
      previewUrl: "http://127.0.0.1:1",
      build: async () => ({ success: false, output: "line\nError: cannot find module x" }),
    });
    expect(failed).toMatchObject({
      passed: false,
      reason: "The app didn't build.",
      detail: expect.stringContaining("cannot find module x"),
    });

    const stopped = await runSmoke(project, { build: okBuild });
    expect(stopped).toMatchObject({
      passed: false,
      reason: "The preview isn't running, so the screens couldn't be checked.",
    });
  });
});
