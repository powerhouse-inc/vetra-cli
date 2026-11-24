/**
 * The Cli's own files in a project stay under `.ph/vetra/`: the helper names
 * nothing outside it, and the modules that write them name no `.ph` path of
 * their own. The agent's session is the store's, kept as every tool's is.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAgentSession } from "../../src/auth/renown.js";
import { STUDIO_DIR, STUDIO_FILES, studioPath } from "../../src/helpers/studio-paths.js";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

/** The modules that write the Cli's own files in the project. */
const WRITERS = [
  "auth/renown.ts",
  "preview-server/server.ts",
  "helpers/project-lock.ts",
  "launch/orchestrator.ts",
  "launch/product-drive.ts",
  "product/upgrade-existing.ts",
  "cli.ts",
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

describe("the Cli's files in a project", () => {
  let workdir: string | undefined;
  afterEach(() => {
    if (workdir) rmSync(workdir, { recursive: true, force: true });
    workdir = undefined;
  });

  it("are all under .ph/vetra/", () => {
    expect(STUDIO_DIR).toBe(path.join(".ph", "vetra"));
    for (const [name, file] of Object.entries(STUDIO_FILES)) {
      const rel = path.relative(STUDIO_DIR, file);
      expect({ name, inside: !rel.startsWith("..") && !path.isAbsolute(rel) }).toEqual({
        name,
        inside: true,
      });
    }
    expect(studioPath("/p", "downloads")).toBe(path.join("/p", ".ph", "vetra", "downloads"));
  });

  it("are named by the helper only: no writer names a .ph path", () => {
    for (const file of WRITERS) {
      const source = readFileSync(path.join(SRC, file), "utf-8");
      expect({ file, literal: /["']\.ph["'/]/.test(source) }).toEqual({ file, literal: false });
    }
  });

  it("the agent's session is the store's, in .ph/sessions, beside its record", async () => {
    workdir = mkdtempSync(path.join(tmpdir(), "studio-paths-"));
    const savedHome = process.env.PH_IDENTITY_HOME;
    process.env.PH_IDENTITY_HOME = path.join(workdir, "identities");
    try {
      const project = path.join(workdir, "project");
      const session = await openAgentSession(project, { cloud: false });
      expect(session.signer.app.key).toMatch(/^did:key:/);
      const written = filesUnder(project);
      expect(written).toContain(path.join(".ph", "sessions", "vetra-agent-vetra-agent.json"));
      expect(written.some((f) => f.startsWith(path.join(".ph", "credentials") + path.sep))).toBe(
        true,
      );
      expect(written.some((f) => f.startsWith(path.join(".ph", "vetra") + path.sep))).toBe(false);
    } finally {
      if (savedHome === undefined) delete process.env.PH_IDENTITY_HOME;
      else process.env.PH_IDENTITY_HOME = savedHome;
    }
  });
});
