import { afterEach, describe, expect, it } from "@jest/globals";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ISigner } from "document-model";
import type { ModelSpec } from "../../src/launch/compat-launch.js";
import {
  USED_MAX_DOCUMENTS,
  canGoBack,
  refreshRollbackBlocks,
  rollbackBlockedReason,
  usedInDrive,
  type UsedData,
} from "../../src/launch/compat-rollback.js";
import { createDriveClient, type ProductDriveClient } from "../../src/launch/product-drive.js";
import { slowTickPass } from "../../src/triggers/live-health.js";
import "../../src/launch/rollback.js"; // registers the F26 refresh on the slow tick
import { LAUNCH_TRIGGER, launch } from "../../src/launch/orchestrator.js";
import { launchHarness, makeReady, readyChange, type LaunchHarness } from "./orchestrator-helpers.js";

/* ------------------------------------------------------------------------ */

const STATE_V1 = "type TodoState { items: [Item!]! }\ntype Item { id: OID! title: String }";
const STATE_V2 = "type TodoState { items: [Item!]! }\ntype Item { id: OID! title: String done: Boolean }";

const todo = (state: string, ops: string[]): ModelSpec => ({
  documentType: "acme/todo",
  stateSchema: state,
  operations: ops.map((name) => ({ name, inputSchema: `input ${name}Input { id: OID! }` })),
});
const note: ModelSpec = { documentType: "acme/note", stateSchema: "type NoteState { t: String }", operations: [] };

const v1 = [todo(STATE_V1, ["ADD_ITEM"])];
const v2 = [todo(STATE_V2, ["ADD_ITEM"])]; // a field added
const v3 = [todo(STATE_V2, ["ADD_ITEM", "ARCHIVE_ITEM"])]; // an operation added
const v4 = [...v3, note]; // a model added

function used(docs: Record<string, string[]>): UsedData {
  const operationTypes = new Map(Object.entries(docs).map(([t, ops]) => [t, new Set(ops)]));
  return { documentTypes: new Set(Object.keys(docs)), operationTypes, documents: Object.keys(docs).length };
}

describe("canGoBack", () => {
  const later = [
    { number: 2, specs: v2 },
    { number: 3, specs: v3 },
    { number: 4, specs: v4 },
  ];

  it("allows going back when only fields were added after the target", () => {
    expect(canGoBack(v1, used({ "acme/todo": ["ADD_ITEM", "SET_NAME", "UPGRADE_DOCUMENT"] }), later)).toEqual({
      ok: true,
    });
  });

  it("refuses when the data uses an operation added after the target, naming the version that added it", () => {
    const check = canGoBack(v1, used({ "acme/todo": ["ADD_ITEM", "ARCHIVE_ITEM"] }), later);
    expect(check).toEqual({
      ok: false,
      addedIn: 3,
      what: ['operation "ARCHIVE_ITEM" on "acme/todo"'],
      reason:
        "Can't go back automatically: Version 3 added data your users have already used. Ask the agent to undo the change instead.",
    });
    // Version 3 itself knows the operation.
    expect(canGoBack(v3, used({ "acme/todo": ["ADD_ITEM", "ARCHIVE_ITEM"] }), [{ number: 4, specs: v4 }])).toEqual({
      ok: true,
    });
  });

  it("refuses when the data has documents of a model added after the target; k is the earliest version", () => {
    const check = canGoBack(v1, used({ "acme/todo": ["ARCHIVE_ITEM"], "acme/note": [] }), later);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.addedIn).toBe(3);
    expect(check.what).toEqual(['documents of type "acme/note"', 'operation "ARCHIVE_ITEM" on "acme/todo"']);
    expect(canGoBack(v3, used({ "acme/note": [] }), [{ number: 4, specs: v4 }])).toMatchObject({ ok: false, addedIn: 4 });
  });

  it("ignores what no version after the target added; without later versions anything unknown blocks", () => {
    // A type and an operation no later version defines: going back doesn't take them away.
    expect(canGoBack(v1, used({ "acme/todo": ["OLD_OP"], "acme/other": ["X"] }), later)).toEqual({ ok: true });
    expect(canGoBack(v1, used({ "acme/todo": ["ARCHIVE_ITEM"] }))).toMatchObject({
      ok: false,
      addedIn: null,
      reason:
        "Can't go back automatically: A later version added data your users have already used. Ask the agent to undo the change instead.",
    });
    expect(rollbackBlockedReason(3)).toMatch(/^Can't go back automatically: Version 3 added data/);
  });
});

/* ------------------------------------------------------------------------ */

/** A fake live server client: reads answer from `docs`, every write is recorded. */
function fakeDriveClient(
  docs: Array<{ id: string; documentType: string; ops: string[] }>,
  writes: string[],
): ProductDriveClient {
  const write = (name: string) => async () => {
    writes.push(name);
    throw new Error("no writes expected");
  };
  return {
    findDrive: write("findDrive"),
    getProtection: write("getProtection"),
    createDrive: write("createDrive"),
    createDocument: write("createDocument"),
    applyActions: write("applyActions"),
    setProtection: write("setProtection"),
    listDocuments: async () => docs.map((d) => ({ id: d.id, name: d.id, documentType: d.documentType })),
    operationTypes: async (id) => [...new Set(docs.find((d) => d.id === id)?.ops ?? [])],
  };
}

describe("usedInDrive", () => {
  const ctx = (client: ProductDriveClient) => ({
    workdir: "/tmp",
    config: { cloudSwitchboardUrl: "https://cloud.example.test" },
    driveClient: async () => client,
  });

  it("reads the drive's documents and their operation types, and writes nothing", async () => {
    const writes: string[] = [];
    const client = fakeDriveClient(
      [
        { id: "d1", documentType: "acme/todo", ops: ["ADD_ITEM", "ADD_ITEM"] },
        { id: "d2", documentType: "acme/todo", ops: ["ARCHIVE_ITEM"] },
        { id: "d3", documentType: "acme/note", ops: [] },
      ],
      writes,
    );
    const u = await usedInDrive(ctx(client), "https://team-todo-switchboard.vetra.io", "drive-1");
    expect(u.documents).toBe(3);
    expect([...u.documentTypes].sort()).toEqual(["acme/note", "acme/todo"]);
    expect([...u.operationTypes.get("acme/todo")!].sort()).toEqual(["ADD_ITEM", "ARCHIVE_ITEM"]);
    expect(writes).toEqual([]);
  });

  it("stops past its bounds and when the client can't read histories", async () => {
    const many = Array.from({ length: USED_MAX_DOCUMENTS + 1 }, (_, i) => ({ id: `d${i}`, documentType: "acme/todo", ops: [] }));
    await expect(usedInDrive(ctx(fakeDriveClient(many, [])), "https://x", "drive-1")).rejects.toThrow(/more than/);
    const noOps: ProductDriveClient = { ...fakeDriveClient([], []), operationTypes: undefined };
    await expect(usedInDrive(ctx(noOps), "https://x", "drive-1")).rejects.toThrow(/operation histories/);
  });

  describe("on the live server's GraphQL", () => {
    let close: (() => Promise<void>) | undefined;
    afterEach(async () => {
      await close?.();
      close = undefined;
    });

    it("pages through each document's operations with read-only queries", async () => {
      const ops: string[] = [];
      const histories: Record<string, string[]> = { d1: ["ADD_ITEM", "ADD_ITEM", "ARCHIVE_ITEM"], d2: ["SET_NAME"] };
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString()));
        req.on("end", () => {
          const parsed = JSON.parse(body) as { operationName?: string; query: string; variables: Record<string, unknown> };
          const op = parsed.operationName ?? /(?:mutation|query)\s+(\w+)/.exec(parsed.query)?.[1] ?? "?";
          ops.push(op);
          let data: unknown = null;
          if (op === "FindDocuments") {
            const items = Object.keys(histories).map((id) => ({
              id,
              slug: id,
              name: id,
              documentType: "acme/todo",
              revisionsList: [{ scope: "global", revision: histories[id].length }],
            }));
            data = { findDocuments: { items, hasNextPage: false, hasPreviousPage: false, cursor: null } };
          } else if (op === "GetDocumentOperations") {
            const filter = parsed.variables.filter as { documentIdOrSlug: string };
            const paging = (parsed.variables.paging ?? {}) as { cursor?: string };
            const all = histories[filter.documentIdOrSlug] ?? [];
            // Two operations per page, to exercise the paging.
            const start = paging.cursor ? Number(paging.cursor) : 0;
            const slice = all.slice(start, start + 2);
            const next = start + 2 < all.length;
            data = {
              documentOperations: {
                hasNextPage: next,
                hasPreviousPage: start > 0,
                cursor: next ? String(start + 2) : null,
                items: slice.map((type, i) => ({
                  index: start + i,
                  timestampUtcMs: "0",
                  hash: "h",
                  skip: 0,
                  action: { id: `a${start + i}`, type, timestampUtcMs: "0", input: {}, scope: "global" },
                })),
              },
            };
          }
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ data }));
        });
      });
      const url = await new Promise<string>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      );
      close = () => new Promise((r) => server.close(() => r()));
      const signer = { user: { address: "0xaa" } } as unknown as ISigner;
      const cctx = {
        workdir: "/tmp",
        config: { cloudSwitchboardUrl: "https://cloud.example.test" },
        bearerToken: async () => "bearer-xyz",
      };
      const u = await usedInDrive(
        { ...cctx, driveClient: (endpoint) => createDriveClient(cctx, endpoint, { signer }) },
        url,
        "drive-1",
      );
      expect([...u.operationTypes.get("acme/todo")!].sort()).toEqual(["ADD_ITEM", "ARCHIVE_ITEM", "SET_NAME"]);
      expect(new Set(ops)).toEqual(new Set(["FindDocuments", "GetDocumentOperations"]));
      expect(ops.filter((o) => o === "GetDocumentOperations")).toHaveLength(3);
    });
  });
});

/* ------------------------------------------------------------------------ */

describe("refreshRollbackBlocks (F26)", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  /** Versions 1–3 live in turn (v2 adds a field, v3 an operation); models read from a table. */
  async function threeVersions(docs: Array<{ id: string; documentType: string; ops: string[] }>, writes: string[]) {
    h = await launchHarness();
    const specs: Record<string, ModelSpec[]> = { v1, v2, v3 };
    h.octx.compatDeps = { readModelSpecs: async (_wd, tag) => specs[tag] };
    h.octx.driveClient = async () => fakeDriveClient(docs, writes);
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    for (const id of ["change-2", "change-3"]) {
      await readyChange(h, id);
      await launch(h.octx, { changeId: id, trigger: LAUNCH_TRIGGER });
    }
    return h;
  }

  it("records the blocked versions once, and clears them when the data allows going back", async () => {
    const writes: string[] = [];
    const docs = [{ id: "d1", documentType: "acme/todo", ops: ["ADD_ITEM", "ARCHIVE_ITEM"] }];
    const harness = await threeVersions(docs, writes);
    expect(await refreshRollbackBlocks(harness.octx)).toBe(2);
    let s = await harness.state();
    const blocked = rollbackBlockedReason(3);
    expect(s.versions.map((v) => [v.number, v.rollbackBlockedReason])).toEqual([
      [1, blocked],
      [2, blocked],
      [3, null],
    ]);
    // Nothing changed: nothing written again.
    expect(await refreshRollbackBlocks(harness.octx)).toBe(0);

    // The ARCHIVE_ITEM document's history no longer counts (e.g. a different drive state): cleared.
    docs[0].ops = ["ADD_ITEM"];
    expect(await refreshRollbackBlocks(harness.octx)).toBe(2);
    s = await harness.state();
    expect(s.versions.every((v) => v.rollbackBlockedReason === null)).toBe(true);
    expect(writes).toEqual([]);
  });

  it("changes nothing when the drive can't be read, and runs on the slow tick", async () => {
    const writes: string[] = [];
    const docs = [{ id: "d1", documentType: "acme/todo", ops: ["ARCHIVE_ITEM"] }];
    const harness = await threeVersions(docs, writes);
    harness.octx.driveClient = async () => {
      throw new Error("offline");
    };
    expect(await refreshRollbackBlocks(harness.octx)).toBe(0);
    expect((await harness.state()).versions.every((v) => v.rollbackBlockedReason === null)).toBe(true);
    expect(harness.lines.some((l) => l.includes("wasn't checked: offline"))).toBe(true);

    harness.octx.driveClient = async () => fakeDriveClient(docs, writes);
    await slowTickPass(harness.octx);
    expect((await harness.state()).versions.find((v) => v.number === 2)?.rollbackBlockedReason).toBe(
      rollbackBlockedReason(3),
    );
  });

  it("a version whose models can't be read keeps its stored reason", async () => {
    const harness = await threeVersions([{ id: "d1", documentType: "acme/todo", ops: ["ARCHIVE_ITEM"] }], []);
    harness.octx.compatDeps = {
      readModelSpecs: async (_wd, tag) => {
        if (tag === "v1") throw new Error("tag missing");
        return { v2, v3 }[tag as "v2" | "v3"];
      },
    };
    expect(await refreshRollbackBlocks(harness.octx)).toBe(1);
    const s = await harness.state();
    expect(s.versions.map((v) => v.rollbackBlockedReason)).toEqual([null, rollbackBlockedReason(3), null]);
    expect(harness.lines.some((l) => l.includes("Version 1 not checked: tag missing"))).toBe(true);
  });
});
