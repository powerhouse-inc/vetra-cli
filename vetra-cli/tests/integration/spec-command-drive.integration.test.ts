/**
 * Integration tests for the `spec-*` write commands pushing the embedded drive
 * directly.
 *
 * Each command writes the filesystem `specs/` unconditionally, and — when a
 * reactor is running (signalled by a truthy `context.folders`) — ALSO pushes
 * the change into the embedded `vetra` drive synchronously, without the
 * `spec-fs-sync` watcher round-trip. These tests build an in-memory reactor,
 * hand the command a fake `context` whose `reactor()` resolves it, and assert:
 *   - create  → drive gets a file node + a gettable doc with the right state
 *   - update  → drive doc state reflects the new actions; re-run is idempotent
 *   - delete  → drive node + document removed
 *   - folders absent → FS only, drive untouched, reactor never booted
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
import type { AppModuleDocument } from "@powerhousedao/vetra/document-models/app-module";
import { specCreate } from "../../src/commands/spec/create.js";
import { specUpdate } from "../../src/commands/spec/update.js";
import { specDelete } from "../../src/commands/spec/delete.js";

const APP_TYPE = "powerhouse/app";

interface CapturedLog {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

function makeLog(): {
  logs: CapturedLog[];
  api: {
    debug: (m: string) => void;
    info: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
} {
  const logs: CapturedLog[] = [];
  return {
    logs,
    api: {
      debug: (m) => logs.push({ level: "debug", msg: m }),
      info: (m) => logs.push({ level: "info", msg: m }),
      warn: (m) => logs.push({ level: "warn", msg: m }),
      error: (m) => logs.push({ level: "error", msg: m }),
    },
  };
}

describe("spec-* commands → embedded drive", () => {
  let module: ReactorClientModule;
  let tmpDir: string;
  let driveId: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spec-cmd-drive-it-"));
    // resolveReactorProjectPath only checks for this file's existence.
    await fs.writeFile(path.join(tmpDir, "powerhouse.config.json"), "{}");

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

  afterEach(async () => {
    await module.reactor.kill().completed;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function driveNodes(): Promise<
    Array<{ id: string; name: string; kind: string; parentFolder?: string | null }>
  > {
    const d = (await module.client.get(driveId)) as any;
    return d?.state?.global?.nodes ?? [];
  }

  /** A context whose folders is truthy → command pushes the running reactor. */
  function runningContext(log?: ReturnType<typeof makeLog>["api"]) {
    let reactorCalls = 0;
    const ctx = {
      workdir: tmpDir,
      folders: {} as never,
      reactor: async () => {
        reactorCalls++;
        return {
          client: module.client,
          personalDriveId: driveId,
          driveId,
        };
      },
      log,
    } as never;
    return { ctx, reactorCalls: () => reactorCalls };
  }

  it("create pushes a new spec into the drive (file node + gettable doc)", async () => {
    const { logs, api: log } = makeLog();
    const { ctx } = runningContext(log);

    const res = await specCreate.execute(
      { project: undefined, type: APP_TYPE, name: "Drive App", dryRun: false },
      ctx,
    );
    // The id is on the saved doc — recover it from the drive's file node.
    const nodes = await driveNodes();
    const fileNode = nodes.find((n) => n.kind === "file");
    expect(fileNode).toBeDefined();
    expect(res.text).toContain("Drive App");

    const inDrive = await module.client.get<AppModuleDocument>(fileNode!.id);
    expect(inDrive.header.documentType).toBe(APP_TYPE);
    expect(inDrive.header.name).toBe("Drive App");
    expect(logs.some((l) => l.level === "error")).toBe(false);

    // Single-project layout (specs at workdir/specs) → file node at root.
    expect(fileNode!.parentFolder ?? null).toBeNull();
  }, 15_000);

  it("update pushes new ops into the drive doc; re-run is idempotent", async () => {
    const { ctx } = runningContext();
    await specCreate.execute(
      { project: undefined, type: APP_TYPE, name: "Up App", dryRun: false },
      ctx,
    );
    const fileNode = (await driveNodes()).find((n) => n.kind === "file")!;
    const docId = fileNode.id;

    await specUpdate.execute(
      {
        project: undefined,
        name: "Up App",
        actions: [{ type: "SET_APP_NAME", input: { name: "renamed-app" } }],
        from: undefined,
      },
      ctx,
    );

    let inDrive = await module.client.get<AppModuleDocument>(docId);
    expect((inDrive.state.global as { name: string }).name).toBe("renamed-app");

    // Re-apply the same file (SET_APP_NAME changes state.global.name, not
    // header.name, so the spec is still found by its display name "Up App").
    // The drive dedups by action.id, so this must not duplicate the file node.
    await specUpdate.execute(
      {
        project: undefined,
        name: "Up App",
        actions: [{ type: "SET_APP_NAME", input: { name: "renamed-app" } }],
        from: undefined,
      },
      ctx,
    );
    inDrive = await module.client.get<AppModuleDocument>(docId);
    expect((inDrive.state.global as { name: string }).name).toBe("renamed-app");
    expect(
      (await driveNodes()).filter((n) => n.kind === "file" && n.id === docId),
    ).toHaveLength(1);
  }, 15_000);

  it("delete removes the spec's node and document from the drive", async () => {
    const { ctx } = runningContext();
    await specCreate.execute(
      { project: undefined, type: APP_TYPE, name: "Del App", dryRun: false },
      ctx,
    );
    const docId = (await driveNodes()).find((n) => n.kind === "file")!.id;
    await module.client.get(docId); // present before delete

    await specDelete.execute({ project: undefined, name: "Del App" }, ctx);

    expect(
      (await driveNodes()).some((n) => n.kind === "file" && n.id === docId),
    ).toBe(false);
    await expect(module.client.get(docId)).rejects.toBeTruthy();
  }, 15_000);

  it("with folders absent: writes FS only, leaves the drive untouched, never boots the reactor", async () => {
    let reactorCalls = 0;
    const ctx = {
      workdir: tmpDir,
      folders: undefined,
      reactor: async () => {
        reactorCalls++;
        return { client: module.client, personalDriveId: driveId, driveId };
      },
      log: makeLog().api,
    } as never;

    await specCreate.execute(
      { project: undefined, type: APP_TYPE, name: "Fs Only", dryRun: false },
      ctx,
    );

    // File written to disk.
    const specsDir = path.join(tmpDir, "specs");
    const wrote = await fs
      .stat(specsDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    expect(wrote).toBe(true);

    // Drive untouched, reactor never resolved.
    expect((await driveNodes()).some((n) => n.kind === "file")).toBe(false);
    expect(reactorCalls).toBe(0);
  }, 15_000);
});
