import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rollbackBlockedReason, rollbackUncheckedReason } from "../../src/launch/compat-rollback.js";
import { restoreVersion, snapshot } from "../../src/launch/git-versions.js";
import { LAUNCH_TRIGGER, launch } from "../../src/launch/orchestrator.js";
import type { ProductDriveClient } from "../../src/launch/product-drive.js";
import { goBack } from "../../src/launch/rollback.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { onSlowTick, slowTickPass } from "../../src/triggers/live-health.js";
import { newRequestsMemory, requestsPass } from "../../src/triggers/product-requests.js";
import { AT, a, launchHarness, makeReady, readyChange, type LaunchHarness } from "./orchestrator-helpers.js";

// Real git: three snapshots per test.
jest.setTimeout(30_000);

const BY = "did:key:owner";
const MODEL = "todo-app/document-models/todo/todo.json";

/** The todo model as a version has it: its state schema and operations. */
function modelJson(state: string, ops: string[]): string {
  return JSON.stringify({
    id: "acme/todo",
    name: "Todo",
    specifications: [
      {
        version: 1,
        state: { global: { schema: state }, local: { schema: "" } },
        modules: [
          { id: "m", name: "items", operations: ops.map((name) => ({ name, schema: `input ${name}Input { id: OID! }` })) },
        ],
      },
    ],
  });
}

const V1 = modelJson("type TodoState { items: [Item!]! }\ntype Item { id: OID! title: String }", ["ADD_ITEM"]);
// Version 2 adds a field; Version 3 adds an operation.
const V2 = modelJson("type TodoState { items: [Item!]! }\ntype Item { id: OID! title: String done: Boolean }", ["ADD_ITEM"]);
const V3 = modelJson("type TodoState { items: [Item!]! }\ntype Item { id: OID! title: String done: Boolean }", [
  "ADD_ITEM",
  "ARCHIVE_ITEM",
]);

interface FakeServer {
  docs: Array<{ id: string; documentType: string; ops: string[] }>;
  /** Every call that would change something on the live server. */
  writes: string[];
}

/** The live server: reads answer from `docs`; any write is recorded (and refused). */
function liveServer(): FakeServer & { client: ProductDriveClient } {
  const server: FakeServer = { docs: [], writes: [] };
  const write = (name: string) => async () => {
    server.writes.push(name);
    throw new Error(`unexpected ${name}`);
  };
  const client: ProductDriveClient = {
    findDrive: write("findDrive"),
    getProtection: write("getProtection"),
    createDrive: write("createDrive"),
    createDocument: write("createDocument"),
    applyActions: write("applyActions"),
    setProtection: write("setProtection"),
    listDocuments: async () => server.docs.map((d) => ({ id: d.id, name: d.id, documentType: d.documentType })),
    operationTypes: async (id) => [...new Set(server.docs.find((d) => d.id === id)?.ops ?? [])],
  };
  return Object.assign(server, { client });
}

describe("go back (D6)", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  function write(rel: string, content: string): void {
    const file = path.join(h!.workdir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  function read(rel: string): string {
    return fs.readFileSync(path.join(h!.workdir, rel), "utf8");
  }

  function gitShow(ref: string, rel: string): string {
    return execFileSync("git", ["show", `${ref}:${rel}`], { cwd: h!.workdir, encoding: "utf8" });
  }

  /**
   * Versions 1–3 launched for real in git (snapshot + tags), each with its
   * model; the cloud and the live server are fakes. Version 3 is live.
   */
  async function threeVersions(): Promise<{ h: LaunchHarness; live: ReturnType<typeof liveServer> }> {
    h = await launchHarness({ snapshot, restoreVersion });
    const live = liveServer();
    h.octx.driveClient = async () => live.client;
    h.octx.compatDeps = {}; // the real check: git tags + the live server
    write("todo-app/powerhouse.config.json", "{}\n");
    write(MODEL, V1);
    await makeReady(h);
    expect((await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER })).status).toBe("LIVE");
    write(MODEL, V2);
    await readyChange(h, "change-2");
    expect((await launch(h.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER })).status).toBe("LIVE");
    write(MODEL, V3);
    await readyChange(h, "change-3");
    expect((await launch(h.octx, { changeId: "change-3", trigger: LAUNCH_TRIGGER })).status).toBe("LIVE");
    h.calls.length = 0;
    return { h, live };
  }

  async function requestRollback(harness: LaunchHarness, m: number): Promise<void> {
    await dispatchProduct(harness.ctx, [a.requestRollback({ versionNumber: m, requestedAt: AT, requestedBy: BY })]);
  }

  it("rollback dispatches nothing to the product drive", async () => {
    const { h, live } = await threeVersions();
    live.docs.push(
      { id: "doc-1", documentType: "acme/todo", ops: ["ADD_ITEM", "SET_NAME"] },
      { id: "doc-2", documentType: "acme/todo", ops: ["ADD_ITEM"] },
    );
    await requestRollback(h, 2);

    expect(await goBack(h.octx, 2)).toEqual({ status: "DONE" });

    expect(live.writes).toEqual([]);
    expect(h.calls).toEqual(["rollback dep-2", "wait dep-2-again"]);
    const s = await h.state();
    expect(s.liveVersion).toBe(2);
    expect(s.pendingRequest).toBeNull();
  });

  it("rollback refused when the drive uses an operation added after the target", async () => {
    const { h, live } = await threeVersions();
    live.docs.push({ id: "doc-1", documentType: "acme/todo", ops: ["ADD_ITEM", "ARCHIVE_ITEM"] });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.workdir, encoding: "utf8" });
    await requestRollback(h, 2);

    const reason =
      "Can't go back automatically: Version 3 added data your users have already used. Ask the agent to undo the change instead.";
    expect(await goBack(h.octx, 2)).toEqual({ status: "REFUSED", reason });

    // Nothing changed: no cloud call, the code and the live version stay, the drive untouched.
    expect(h.calls).toEqual([]);
    expect(live.writes).toEqual([]);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.workdir, encoding: "utf8" })).toBe(head);
    const s = await h.state();
    expect(s.liveVersion).toBe(3);
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toEqual({ kind: "ROLLBACK", reason, at: AT });
    expect(s.versions.find((v) => v.number === 2)?.rollbackBlockedReason).toBe(reason);
    // The page can't ask again for a blocked version.
    await expect(requestRollback(h, 2)).rejects.toThrow(reason);
    expect((await h.state()).pendingRequest).toBeNull();
  });

  it("rollback allowed when only fields were added after the target", async () => {
    const { h, live } = await threeVersions();
    // Uses Version 2's field (`done`) through ADD_ITEM only; Version 3's operation unused.
    live.docs.push({ id: "doc-1", documentType: "acme/todo", ops: ["ADD_ITEM"] });
    await requestRollback(h, 1);

    expect(await goBack(h.octx, 1)).toEqual({ status: "DONE" });

    expect(h.calls).toEqual(["rollback dep-1", "wait dep-1-again"]);
    expect((await h.state()).liveVersion).toBe(1);
  });

  it("after go back the next change starts from the target's code", async () => {
    const { h } = await threeVersions();
    await requestRollback(h, 1);
    expect(await goBack(h.octx, 1)).toEqual({ status: "DONE" });

    expect(read(MODEL)).toBe(V1);
    // The next change edits Version 1's code; its version is built on it.
    write("todo-app/notes.md", "next change\n");
    await readyChange(h, "change-4");
    expect((await launch(h.octx, { changeId: "change-4", trigger: LAUNCH_TRIGGER })).status).toBe("LIVE");
    expect(gitShow("v4", MODEL)).toBe(V1);
    expect(gitShow("v4", "todo-app/notes.md")).toBe("next change\n");
    // Newer versions' code is still there by their tags.
    expect(gitShow("v3", MODEL)).toBe(V3);
  });

  it("versions after the target stay listed and can be launched again", async () => {
    const { h, live } = await threeVersions();
    live.docs.push({ id: "doc-1", documentType: "acme/todo", ops: ["ADD_ITEM"] });
    await requestRollback(h, 1);
    expect(await goBack(h.octx, 1)).toEqual({ status: "DONE" });
    let s = await h.state();
    expect(s.versions.map((v) => [v.number, v.status])).toEqual([
      [1, "LIVE"],
      [2, "PREVIOUS"],
      [3, "PREVIOUS"],
    ]);

    // Forward again to Version 3: its code and its deployment come back.
    await requestRollback(h, 3);
    expect(await goBack(h.octx, 3)).toEqual({ status: "DONE" });
    s = await h.state();
    expect(s.liveVersion).toBe(3);
    expect(s.versions.map((v) => v.status)).toEqual(["PREVIOUS", "PREVIOUS", "LIVE"]);
    expect(read(MODEL)).toBe(V3);
    expect(live.writes).toEqual([]);
  });

  it("fails closed when the live data can't be read, and the request trigger goes through the check", async () => {
    const { h } = await threeVersions();
    h.octx.driveClient = async () => {
      throw new Error("offline");
    };
    await requestRollback(h, 2);

    expect(await requestsPass(h.octx, newRequestsMemory())).toBe("rollback");

    expect(h.calls).toEqual([]);
    const s = await h.state();
    expect(s.liveVersion).toBe(3);
    expect(s.lastRequestFailure).toEqual({ kind: "ROLLBACK", reason: rollbackUncheckedReason(2), at: AT });
    expect(s.versions.every((v) => v.rollbackBlockedReason === null)).toBe(true);
    expect(rollbackBlockedReason(3)).toContain("Version 3 added data");
  });

  it("a successful go back works out the blocked versions again for the new live version (F26)", async () => {
    const { h, live } = await threeVersions();
    // Version 3's operation was used; going to Version 3 itself stays possible later.
    live.docs.push({ id: "doc-1", documentType: "acme/todo", ops: ["ADD_ITEM"] });
    await requestRollback(h, 2);
    expect(await goBack(h.octx, 2)).toEqual({ status: "DONE" });
    // Nothing in use is unknown to any version: nothing blocked.
    expect((await h.state()).versions.every((v) => v.rollbackBlockedReason === null)).toBe(true);

    live.docs[0].ops.push("ARCHIVE_ITEM"); // e.g. used while Version 3 was live
    await dispatchProduct(h.ctx, [a.setRollbackBlock({ number: 1, reason: "stale" })]);
    await requestRollback(h, 3);
    expect(await goBack(h.octx, 3)).toEqual({ status: "DONE" });
    const s = await h.state();
    expect(s.versions.map((v) => [v.number, v.rollbackBlockedReason])).toEqual([
      [1, rollbackBlockedReason(3)],
      [2, rollbackBlockedReason(3)],
      [3, null],
    ]);
  });

  it("each launch works out the blocked versions again (F26)", async () => {
    let refreshed = 0;
    h = await launchHarness({
      refreshRollbackBlocks: async () => {
        refreshed += 1;
        return 0;
      },
    });
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    expect(refreshed).toBe(1);
  });

  it("the slow tick runs every handler, a failing one never stops the others", async () => {
    h = await launchHarness();
    const ran: string[] = [];
    const off1 = onSlowTick(async () => {
      ran.push("first");
      throw new Error("boom");
    });
    const off2 = onSlowTick(async () => {
      ran.push("second");
    });
    try {
      await slowTickPass(h.octx);
    } finally {
      off1();
      off2();
    }
    expect(ran).toEqual(["first", "second"]);
    expect(h.lines.some((l) => l.includes("slow tick failed: boom"))).toBe(true);
  });
});
