/**
 * Integration tests for the FS → embedded drive direction of spec sync.
 *
 * Exercises `applyFsChangesToReactor` against an in-memory reactor with
 * the vetra document models registered:
 *   - create a `.phd` on disk (no reactor involved), apply → drive materializes it
 *   - mutate the `.phd` offline, apply → drive picks up the new ops
 *   - apply the same file twice → reactor's per-action.id dedup makes pass #2 a no-op
 *   - round-trip with `syncSpecsToFs` (the drive→FS direction) → no infinite loop
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ReactorBuilder,
  ReactorClientBuilder,
  type ReactorClientModule,
} from "@powerhousedao/reactor";
import { documentModels as vetraDocumentModels } from "@powerhousedao/vetra";
import { documentModels as driveDocumentModels } from "@powerhousedao/clint-common";
import { AppModuleV1 } from "@powerhousedao/vetra/document-models";
import {
  type AppModuleDocument,
  setAppName,
} from "@powerhousedao/vetra/document-models/app-module";
import { saveSpec, specPath } from "@powerhousedao/vetra/codegen";
import { baseLoadFromFile } from "document-model/node";
import {
  applyFsChangesToReactor,
  buildLoadJobsForFile,
  specForPath,
} from "../../src/triggers/spec-fs-sync.js";
import { syncSpecsToFs } from "../../src/triggers/spec-sync.js";

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  opts: { timeout?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 5_000;
  const intervalMs = opts.intervalMs ?? 25;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeout}ms`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface CapturedLog {
  level: "debug" | "warn" | "error";
  msg: string;
}

function makeLog(): { logs: CapturedLog[]; api: {
  debug: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
} } {
  const logs: CapturedLog[] = [];
  return {
    logs,
    api: {
      debug: (m) => logs.push({ level: "debug", msg: m }),
      warn: (m) => logs.push({ level: "warn", msg: m }),
      error: (m) => logs.push({ level: "error", msg: m }),
    },
  };
}

describe("spec-fs-sync FS → drive", () => {
  let module: ReactorClientModule;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-fs-sync-it-"));
    const builder = new ReactorBuilder().withDocumentModels([
      ...(driveDocumentModels as unknown as any[]),
      ...(vetraDocumentModels as unknown as any[]),
    ]);
    module = await new ReactorClientBuilder()
      .withReactorBuilder(builder)
      .buildModule();
  });

  afterEach(async () => {
    await module.reactor.kill().completed;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Helpers (pure path inference) ────────────────────────────────

  describe("specForPath", () => {
    it("maps a known subdir to the spec registration", () => {
      const p = path.join(tmpDir, "specs", "apps", "foo.phdm.phd");
      const spec = specForPath(p, tmpDir);
      expect(spec?.documentType).toBe("powerhouse/app");
    });

    it("returns undefined for paths outside specs/", () => {
      expect(specForPath(path.join(tmpDir, "foo.phd"), tmpDir)).toBeUndefined();
    });

    it("returns undefined for an unknown subdir", () => {
      const p = path.join(tmpDir, "specs", "unknown", "foo.phd");
      expect(specForPath(p, tmpDir)).toBeUndefined();
    });
  });

  /**
   * Produce a well-formed `.phd` for `documentType` "powerhouse/app" with
   * the given name. The flow has to round-trip the doc through a reactor
   * (here, the test's own) so the file carries the create + upgrade
   * operations — that's the form an external editor or another reactor
   * would actually produce.
   *
   * `client.get` returns the current snapshot with an empty `operations`
   * field; we have to assemble the operation history from
   * `reactor.getOperations` (per-scope) before passing the doc to
   * saveSpec, or the saved file is unsyncable (no ops to replay).
   */
  async function makeSpecFile(name: string): Promise<{ id: string; path: string }> {
    const draft = AppModuleV1.utils.createDocument();
    draft.header.name = name;
    draft.header.documentType = "powerhouse/app";
    await module.client.create(draft as never);
    return { id: draft.header.id, path: await persistDocToFs(draft.header.id, name) };
  }

  async function persistDocToFs(id: string, _name: string): Promise<string> {
    const created = await module.client.get<AppModuleDocument>(id);
    const opsByScope = await module.reactor.getOperations(id);
    const operations: Record<string, unknown[]> = {};
    for (const [scope, paged] of Object.entries(opsByScope)) {
      operations[scope] = (paged as { results: unknown[] }).results;
    }
    const enriched = { ...created, operations } as unknown as Parameters<typeof saveSpec>[0];
    return await saveSpec(enriched, tmpDir);
  }

  // ── FS → drive: materialize a doc the drive has never seen ───────

  it("materializes a doc into the drive from a .phd produced by a separate reactor", async () => {
    // A "producer" reactor stands in for the source of the .phd — e.g.
    // a teammate's reactor, an editor running standalone, or a previous
    // session. Its operations land on disk; we then sync that file into
    // `module` (which has no prior knowledge of the doc).
    const producerBuilder = new ReactorBuilder().withDocumentModels([
      ...(driveDocumentModels as unknown as any[]),
      ...(vetraDocumentModels as unknown as any[]),
    ]);
    const producer = await new ReactorClientBuilder()
      .withReactorBuilder(producerBuilder)
      .buildModule();
    try {
      const draft = AppModuleV1.utils.createDocument();
      draft.header.name = "fresh-app";
      draft.header.documentType = "powerhouse/app";
      await producer.client.create(draft as never);

      const created = await producer.client.get(draft.header.id);
      const opsByScope = await producer.reactor.getOperations(draft.header.id);
      const operations: Record<string, unknown[]> = {};
      for (const [scope, paged] of Object.entries(opsByScope)) {
        operations[scope] = (paged as { results: unknown[] }).results;
      }
      const enriched = { ...created, operations } as unknown as Parameters<typeof saveSpec>[0];
      const filePath = await saveSpec(enriched, tmpDir);
      expect(await pathExists(filePath)).toBe(true);

      // Confirm the receiving drive (`module`) does not know the doc.
      await expect(module.client.get(draft.header.id)).rejects.toBeTruthy();

      const { logs, api: log } = makeLog();
      const submitted = await applyFsChangesToReactor(
        [filePath],
        tmpDir,
        module as never,
        log,
      );
      expect(submitted).toBeGreaterThan(0);

      await waitUntil(async () => {
        try {
          await module.client.get(draft.header.id);
          return true;
        } catch {
          return false;
        }
      });

      const inDrive = await module.client.get<AppModuleDocument>(draft.header.id);
      expect(inDrive.header.id).toBe(draft.header.id);
      expect(inDrive.header.documentType).toBe("powerhouse/app");
      expect(logs.some((l) => l.level === "error")).toBe(false);
    } finally {
      await producer.reactor.kill().completed;
    }
  }, 15_000);

  // ── FS → drive: mutate offline, then sync ────────────────────────

  it("applies new operations from a mutated .phd into an existing drive doc", async () => {
    const { id, path: filePath } = await makeSpecFile("mut-app");

    // Edit the file offline (no reactor involvement): load, apply
    // setAppName via the reducer, save back.
    const loaded = await baseLoadFromFile(filePath, AppModuleV1.reducer);
    const mutated = AppModuleV1.reducer(
      loaded,
      setAppName({ name: "renamed-offline" }),
    );
    await saveSpec(mutated, tmpDir);

    await applyFsChangesToReactor([filePath], tmpDir, module as never);

    await waitUntil(async () => {
      const inDrive = await module.client.get<AppModuleDocument>(id);
      return (
        (inDrive.state.global as { name: string }).name === "renamed-offline"
      );
    });

    const inDrive = await module.client.get<AppModuleDocument>(id);
    expect((inDrive.state.global as { name: string }).name).toBe(
      "renamed-offline",
    );
  }, 15_000);

  // ── FS → drive: idempotent (re-sync is a no-op) ──────────────────

  it("re-syncing an unchanged file does not add duplicate operations", async () => {
    const { id, path: filePath } = await makeSpecFile("dedup-app");

    // The doc is already in the drive (makeSpecFile created it there).
    // Take an ops snapshot, then feed the .phd through twice more.
    const opsBefore = await module.client.getOperations(id);
    const countBefore = opsBefore.results.length;
    expect(countBefore).toBeGreaterThan(0);

    await applyFsChangesToReactor([filePath], tmpDir, module as never);
    await applyFsChangesToReactor([filePath], tmpDir, module as never);

    // Give the queue a tick; if dedup were broken the count would grow.
    await new Promise((r) => setTimeout(r, 100));

    const opsAfter = await module.client.getOperations(id);
    expect(opsAfter.results.length).toBe(countBefore);
  }, 15_000);

  // ── Round-trip: drive ↔ FS closes naturally ──────────────────────

  it("round-trips drive → FS → drive without an infinite loop or extra ops", async () => {
    // makeSpecFile already writes a fully-populated .phd (with op
    // history attached) — that's the input shape the FS→drive direction
    // is supposed to dedup against.
    const { id, path: filePath } = await makeSpecFile("round-trip");
    expect(await pathExists(filePath)).toBe(true);

    // For symmetry with production drive→FS, also call syncSpecsToFs.
    // It currently writes the snapshot-only form (no ops); the file on
    // disk from makeSpecFile already has the ops, so we re-use that.
    const inDrive = await module.client.get<AppModuleDocument>(id);
    await syncSpecsToFs([inDrive as never], tmpDir);
    await persistDocToFs(id, "round-trip"); // re-attach ops onto the file

    const opsBefore = (await module.client.getOperations(id)).results.length;

    // FS → drive: the file's ops are all already in the store; this must
    // be a successful no-op (dedup by action.id).
    const { logs, api: log } = makeLog();
    await applyFsChangesToReactor([filePath], tmpDir, module as never, log);
    await applyFsChangesToReactor([filePath], tmpDir, module as never, log);

    await new Promise((r) => setTimeout(r, 100));

    const opsAfter = (await module.client.getOperations(id)).results.length;
    expect(opsAfter).toBe(opsBefore);
    expect(logs.some((l) => l.level === "error")).toBe(false);
  }, 15_000);

  // ── Misc: invalid paths handled gracefully ───────────────────────

  it("skips paths that aren't under specs/<known-subdir>/ and reports via warn", async () => {
    const bogus = path.join(tmpDir, "not-specs.phd");
    await fs.writeFile(bogus, "garbage");
    const { logs, api: log } = makeLog();
    const jobs = await buildLoadJobsForFile(bogus, tmpDir, log);
    expect(jobs).toEqual([]);
    expect(logs.filter((l) => l.level === "warn")).not.toEqual([]);
  });
});
