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
import { driveDocumentModelModule } from "@powerhousedao/shared/document-drive";
import { AppModuleV1 } from "@powerhousedao/vetra/document-models";
import {
  type AppModuleDocument,
  setAppName,
} from "@powerhousedao/vetra/document-models/app-module";
import { saveSpec } from "@powerhousedao/vetra/codegen";
import { baseLoadFromFile } from "document-model/node";
import {
  applyFsChangesToReactor,
  buildLoadJobsForFile,
  projectForPath,
  specForPath,
} from "../../src/helpers/spec-drive-sync.js";
import { specFsSyncTrigger } from "../../src/triggers/spec-fs-sync.js";
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
  let driveId: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-fs-sync-it-"));
    const builder = new ReactorBuilder().withDocumentModels([
      driveDocumentModelModule,
      ...(driveDocumentModels as unknown as any[]),
      ...(vetraDocumentModels as unknown as any[]),
    ]);
    module = await new ReactorClientBuilder()
      .withReactorBuilder(builder)
      .buildModule();
    const drive = await module.client.createEmpty("powerhouse/document-drive");
    driveId = drive.header.id;
    await module.client.rename(driveId, "vetra");
  });

  async function driveNodes(): Promise<
    Array<{ id: string; name: string; kind: string; parentFolder?: string | null }>
  > {
    const d = (await module.client.get(driveId)) as any;
    return d?.state?.global?.nodes ?? [];
  }

  afterEach(async () => {
    await module.reactor.kill().completed;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Helpers (pure path inference) ────────────────────────────────

  describe("specForPath", () => {
    it("maps a known subdir to the spec registration", () => {
      const p = path.join(tmpDir, "specs", "apps", "foo.phdm.phd");
      const spec = specForPath(p);
      expect(spec?.documentType).toBe("powerhouse/app");
    });

    it("maps a workspace-layout path (<workdir>/<project>/specs/<subdir>/)", () => {
      const p = path.join(tmpDir, "workout-tracker", "specs", "apps", "foo.phdm.phd");
      expect(specForPath(p)?.documentType).toBe("powerhouse/app");
    });

    it("maps a vetra-app domain spec subdir (brand-sheet) from the merged registry", () => {
      const p = path.join(tmpDir, "workout-tracker", "specs", "brand-sheet", "x.brs.phd");
      expect(specForPath(p)?.documentType).toBe("powerhouse/brand-sheet");
    });

    it("returns undefined for paths outside specs/", () => {
      expect(specForPath(path.join(tmpDir, "foo.phd"))).toBeUndefined();
    });

    it("returns undefined for an unknown subdir", () => {
      const p = path.join(tmpDir, "specs", "unknown", "foo.phd");
      expect(specForPath(p)).toBeUndefined();
    });
  });

  describe("projectForPath", () => {
    it("returns the project subdir in workspace layout", () => {
      const p = path.join(tmpDir, "workout-tracker", "specs", "apps", "foo.phd");
      expect(projectForPath(p, tmpDir)).toBe("workout-tracker");
    });

    it("returns undefined when specs/ is at the workdir root (single-project)", () => {
      const p = path.join(tmpDir, "specs", "apps", "foo.phd");
      expect(projectForPath(p, tmpDir)).toBeUndefined();
    });

    it("returns undefined for paths outside workdir", () => {
      expect(projectForPath("/elsewhere/specs/apps/foo.phd", tmpDir)).toBeUndefined();
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
    await module.client.create(draft);
    return { id: draft.header.id, path: await persistDocToFs(draft.header.id) };
  }

  async function persistDocToFs(id: string): Promise<string> {
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
      driveDocumentModelModule,
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
      await producer.client.create(draft);
      // A real spec carries content-scope (global) operations; add one so the
      // sync has content to replay (document-scope create ops are ignored —
      // the receiving reactor materializes its own).
      await producer.client.execute(draft.header.id, "main", [
        setAppName({ name: "fresh-app" }),
      ]);

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
        module,
        driveId,
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

      // Single-project layout (saved at tmpDir/specs/) → file node at root.
      const nodes = await driveNodes();
      const fileNode = nodes.find((n) => n.kind === "file" && n.id === draft.header.id);
      expect(fileNode).toBeDefined();
      expect(fileNode?.parentFolder ?? null).toBeNull();
    } finally {
      await producer.reactor.kill().completed;
    }
  }, 15_000);

  // ── FS → drive: snapshot .phd with NO document-scope create op ───
  //
  // Regression for the brand-sheet bug: spec-* tools write snapshots that carry
  // only content-scope ops (createDocument records no document-scope create).
  // The receiving reactor has never seen the doc, so it must materialize one
  // before the content ops can apply — replaying ops alone would stall.

  it("materializes a snapshot .phd (no document-scope create) and syncs its state", async () => {
    // Built via reducer, no reactor — mirrors createSpecDocument + saveSpec.
    let doc = AppModuleV1.utils.createDocument();
    doc.header.name = "snapshot-app";
    doc.header.documentType = "powerhouse/app";
    doc = AppModuleV1.reducer(doc, setAppName({ name: "snap-name" }));
    const filePath = await saveSpec(doc, tmpDir);
    await expect(module.client.get(doc.header.id)).rejects.toBeTruthy();

    const { logs, api: log } = makeLog();
    const submitted = await applyFsChangesToReactor([filePath], tmpDir, module, driveId, log);
    expect(submitted).toBeGreaterThan(0);

    await waitUntil(async () => {
      try {
        await module.client.get(doc.header.id);
        return true;
      } catch {
        return false;
      }
    });
    const inDrive = await module.client.get<AppModuleDocument>(doc.header.id);
    expect((inDrive.state.global as { name: string }).name).toBe("snap-name");
    const nodes = await driveNodes();
    expect(nodes.some((n) => n.kind === "file" && n.id === doc.header.id)).toBe(true);
    expect(logs.some((l) => l.level === "error")).toBe(false);

    // Re-sync is idempotent: no duplicate ops, no duplicate nodes.
    const before = (await module.client.getOperations(doc.header.id)).results.length;
    await applyFsChangesToReactor([filePath], tmpDir, module, driveId, log);
    await new Promise((r) => setTimeout(r, 100));
    expect((await module.client.getOperations(doc.header.id)).results.length).toBe(before);
    expect((await driveNodes()).filter((n) => n.kind === "file" && n.id === doc.header.id)).toHaveLength(1);
  }, 15_000);

  // ── FS → drive: workspace layout files into a per-project folder ──

  it("files a workspace-layout spec under a folder named after its project", async () => {
    const project = "workout-tracker";
    const projectDir = path.join(tmpDir, project);
    const draft = AppModuleV1.utils.createDocument();
    draft.header.name = "ws-app";
    draft.header.documentType = "powerhouse/app";
    await module.client.create(draft);
    const created = await module.client.get(draft.header.id);
    const opsByScope = await module.reactor.getOperations(draft.header.id);
    const operations: Record<string, unknown[]> = {};
    for (const [scope, paged] of Object.entries(opsByScope)) {
      operations[scope] = (paged as { results: unknown[] }).results;
    }
    const enriched = { ...created, operations } as unknown as Parameters<typeof saveSpec>[0];
    const filePath = await saveSpec(enriched, projectDir);
    expect(filePath.startsWith(path.join(projectDir, "specs"))).toBe(true);

    const { logs, api: log } = makeLog();
    await applyFsChangesToReactor([filePath], tmpDir, module, driveId, log);

    const nodes = await driveNodes();
    const folder = nodes.find((n) => n.kind === "folder" && n.name === project);
    expect(folder).toBeDefined();
    const fileNode = nodes.find((n) => n.kind === "file" && n.id === draft.header.id);
    expect(fileNode?.parentFolder).toBe(folder?.id);
    expect(logs.some((l) => l.level === "error")).toBe(false);

    // Re-sync: no duplicate folder/file nodes.
    await applyFsChangesToReactor([filePath], tmpDir, module, driveId, log);
    const after = await driveNodes();
    expect(after.filter((n) => n.kind === "folder" && n.name === project)).toHaveLength(1);
    expect(after.filter((n) => n.kind === "file" && n.id === draft.header.id)).toHaveLength(1);
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

    await applyFsChangesToReactor([filePath], tmpDir, module, driveId);

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

    await applyFsChangesToReactor([filePath], tmpDir, module, driveId);
    await applyFsChangesToReactor([filePath], tmpDir, module, driveId);

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
    await syncSpecsToFs([inDrive], tmpDir);
    await persistDocToFs(id, "round-trip"); // re-attach ops onto the file

    const opsBefore = (await module.client.getOperations(id)).results.length;

    // FS → drive: the file's ops are all already in the store; this must
    // be a successful no-op (dedup by action.id).
    const { logs, api: log } = makeLog();
    await applyFsChangesToReactor([filePath], tmpDir, module, driveId, log);
    await applyFsChangesToReactor([filePath], tmpDir, module, driveId, log);

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

  // ── Live watcher: the path the unit tests don't cover ────────────
  //
  // Drives the real trigger (chokidar setup → poll) and writes a spec into a
  // project subtree that did NOT exist at setup time — the exact scenario that
  // silently failed in production (reactor-project-init runs after startup).

  it("detects a spec written into a new project subtree after setup() and syncs it", async () => {
    const { logs, api: log } = makeLog();
    const ctx = {
      state: specFsSyncTrigger.state!(),
      context: { workdir: tmpDir, log },
      reactor: async () => ({ client: module.client, driveId }),
    } as never as Parameters<NonNullable<typeof specFsSyncTrigger.setup>>[0];

    await specFsSyncTrigger.setup!(ctx);
    try {
      // Project dir + specs subtree created entirely AFTER the watcher started.
      const projectDir = path.join(tmpDir, "late-project");
      const draft = AppModuleV1.utils.createDocument();
      draft.header.name = "late-app";
      draft.header.documentType = "powerhouse/app";
      await module.client.create(draft);
      const created = await module.client.get(draft.header.id);
      const opsByScope = await module.reactor.getOperations(draft.header.id);
      const operations: Record<string, unknown[]> = {};
      for (const [scope, paged] of Object.entries(opsByScope)) {
        operations[scope] = (paged as { results: unknown[] }).results;
      }
      const enriched = { ...created, operations } as unknown as Parameters<typeof saveSpec>[0];
      await saveSpec(enriched, projectDir);

      // chokidar should observe the new nested file (awaitWriteFinish ~75ms).
      await waitUntil(() => (ctx as { state: { changed: Set<string> } }).state.changed.size > 0, {
        timeout: 5_000,
      });
      await specFsSyncTrigger.poll(ctx);

      const nodes = await driveNodes();
      expect(nodes.some((n) => n.kind === "folder" && n.name === "late-project")).toBe(true);
      expect(nodes.some((n) => n.kind === "file" && n.id === draft.header.id)).toBe(true);
      expect(logs.some((l) => l.level === "error")).toBe(false);
    } finally {
      await specFsSyncTrigger.teardown!(ctx);
    }
  }, 20_000);

  // ── Live watcher: external unlink removes the file node from the drive ──
  //
  // A `.phd` deleted externally (git pull, rm) while the daemon runs must drop
  // its file node from the drive. At unlink time the file is gone, so the docId
  // is resolved from the path→docId map populated when the file was synced.

  it("removes a spec's file node from the drive when the .phd is deleted externally", async () => {
    const { logs, api: log } = makeLog();
    const ctx = {
      state: specFsSyncTrigger.state!(),
      context: { workdir: tmpDir, log },
      reactor: async () => ({ client: module.client, driveId }),
    } as never as Parameters<NonNullable<typeof specFsSyncTrigger.setup>>[0];
    const state = (ctx as { state: { changed: Set<string>; removed: Set<string> } }).state;

    await specFsSyncTrigger.setup!(ctx);
    try {
      const projectDir = path.join(tmpDir, "del-project");
      const draft = AppModuleV1.utils.createDocument();
      draft.header.name = "del-app";
      draft.header.documentType = "powerhouse/app";
      await module.client.create(draft);
      const created = await module.client.get(draft.header.id);
      const opsByScope = await module.reactor.getOperations(draft.header.id);
      const operations: Record<string, unknown[]> = {};
      for (const [scope, paged] of Object.entries(opsByScope)) {
        operations[scope] = (paged as { results: unknown[] }).results;
      }
      const enriched = { ...created, operations } as unknown as Parameters<typeof saveSpec>[0];
      const filePath = await saveSpec(enriched, projectDir);

      await waitUntil(() => state.changed.size > 0, { timeout: 5_000 });
      await specFsSyncTrigger.poll(ctx);

      // File node present after the initial sync.
      let nodes = await driveNodes();
      expect(nodes.some((n) => n.kind === "file" && n.id === draft.header.id)).toBe(true);

      // Delete the .phd from disk; the watcher's unlink handler fires.
      await fs.rm(filePath);
      await waitUntil(() => state.removed.size > 0, { timeout: 5_000 });
      await specFsSyncTrigger.poll(ctx);

      nodes = await driveNodes();
      expect(nodes.some((n) => n.kind === "file" && n.id === draft.header.id)).toBe(false);
      expect(logs.some((l) => l.level === "error")).toBe(false);
    } finally {
      await specFsSyncTrigger.teardown!(ctx);
    }
  }, 20_000);

  // ── Live watcher: a rename (unlink old + add new, same doc id) keeps the
  // doc in the drive. poll() processes removed before changed so the re-sync
  // from the new path wins over the old path's removal.
  it("keeps a spec in the drive across an external rename", async () => {
    const { logs, api: log } = makeLog();
    const ctx = {
      state: specFsSyncTrigger.state!(),
      context: { workdir: tmpDir, log },
      reactor: async () => ({ client: module.client, driveId }),
    } as never as Parameters<NonNullable<typeof specFsSyncTrigger.setup>>[0];
    const state = (ctx as { state: { changed: Set<string>; removed: Set<string> } }).state;

    await specFsSyncTrigger.setup!(ctx);
    try {
      const projectDir = path.join(tmpDir, "rename-project");
      const draft = AppModuleV1.utils.createDocument();
      draft.header.name = "rename-app";
      draft.header.documentType = "powerhouse/app";
      await module.client.create(draft);
      const created = await module.client.get(draft.header.id);
      const opsByScope = await module.reactor.getOperations(draft.header.id);
      const operations: Record<string, unknown[]> = {};
      for (const [scope, paged] of Object.entries(opsByScope)) {
        operations[scope] = (paged as { results: unknown[] }).results;
      }
      const enriched = { ...created, operations } as unknown as Parameters<typeof saveSpec>[0];
      const filePath = await saveSpec(enriched, projectDir);

      await waitUntil(() => state.changed.size > 0, { timeout: 5_000 });
      await specFsSyncTrigger.poll(ctx);
      expect(
        (await driveNodes()).some((n) => n.kind === "file" && n.id === draft.header.id),
      ).toBe(true);

      // Rename within the same specs/<subdir>/ — chokidar emits unlink(old) + add(new).
      const renamed = path.join(path.dirname(filePath), `moved-${path.basename(filePath)}`);
      await fs.rename(filePath, renamed);
      await waitUntil(() => state.removed.size > 0 && state.changed.size > 0, {
        timeout: 5_000,
      });
      await specFsSyncTrigger.poll(ctx);

      // Same doc id, still present — not deleted by the old path's removal.
      expect(
        (await driveNodes()).some((n) => n.kind === "file" && n.id === draft.header.id),
      ).toBe(true);
      expect(logs.some((l) => l.level === "error")).toBe(false);
    } finally {
      await specFsSyncTrigger.teardown!(ctx);
    }
  }, 20_000);
});
