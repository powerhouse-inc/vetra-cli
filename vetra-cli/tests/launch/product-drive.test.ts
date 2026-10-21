import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ISigner } from "document-model";
import {
  createDriveClient,
  ensureProductDrive,
  setAccess,
  switchboardGraphqlEndpoint,
  type ProductDriveClient,
  type ProductDriveContext,
} from "../../src/launch/product-drive.js";
import { EXAMPLE_PREFIX, validateSeeds } from "../../src/launch/seed.js";
import { cloudSetProductDrive, STUDIO_SECRET_ENV } from "../../src/launch/cloud-launch.js";
import { LaunchError } from "../../src/launch/errors.js";
import { runSmoke } from "../../src/product/smoke.js";

const SWITCHBOARD = "https://switchboard.todo-app.vetra.io";

const TODO_MODEL = {
  id: "acme/todo-list",
  name: "TodoList",
  extension: ".todo",
  description: "",
  author: { name: "", website: "" },
  specifications: [
    {
      version: 1,
      changeLog: [],
      state: {
        global: {
          schema: "type TodoListState {\n  todos: [Todo!]!\n}\n\ntype Todo {\n  id: OID!\n  title: String!\n  priority: Priority!\n  done: Boolean!\n}\n\nenum Priority {\n  LOW\n  HIGH\n}",
          initialValue: '{"todos":[]}',
          examples: [],
        },
        local: { schema: "", initialValue: "", examples: [] },
      },
      modules: [
        {
          id: "m1",
          name: "todos",
          description: "",
          operations: [
            {
              id: "o1",
              name: "ADD_TODO",
              scope: "global",
              schema: "input AddTodoInput {\n  id: OID!\n  title: String!\n  priority: Priority!\n}",
              description: "",
              template: "",
              reducer: "",
              errors: [],
              examples: [],
            },
            {
              id: "o2",
              name: "COMPLETE_TODO",
              scope: "global",
              schema: "input CompleteTodoInput {\n  id: OID!\n}",
              description: "",
              template: "",
              reducer: "",
              errors: [],
              examples: [],
            },
          ],
        },
      ],
    },
  ],
};

const GOOD_SEED = {
  documentType: "acme/todo-list",
  documents: [
    {
      name: "Example — delete me: Weekend chores",
      actions: [
        { type: "ADD_TODO", input: { id: "t1", title: "Buy milk", priority: "HIGH" } },
        { type: "ADD_TODO", input: { id: "t2", title: "Water plants", priority: "LOW" } },
        { type: "COMPLETE_TODO", input: { id: "t1" } },
      ],
    },
    {
      name: "Example — delete me",
      actions: [{ type: "ADD_TODO", input: { id: "t1", title: "Call mum", priority: "LOW" } }],
    },
  ],
};

async function write(root: string, rel: string, value: unknown): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

interface Recorded {
  drives: string[];
  configured: Array<{ driveId: string; name: string; preferredEditor?: string }>;
  documents: Array<{ driveId: string; documentType: string; name: string; actions: unknown[] }>;
  protection: Array<{ driveId: string; isProtected: boolean }>;
  endpoints: string[];
}

/** An in-memory stand-in for the live server's calls. */
function fakeServer(opts: { failAddAfter?: number; refuseProtection?: boolean } = {}) {
  const rec: Recorded = { drives: [], configured: [], documents: [], protection: [], endpoints: [] };
  let adds = 0;
  const client: ProductDriveClient = {
    async createDrive() {
      const id = `drive-${rec.drives.length + 1}`;
      rec.drives.push(id);
      return id;
    },
    async configureDrive(driveId, input) {
      rec.configured.push({ driveId, ...input });
    },
    async addDocument(driveId, doc) {
      adds++;
      if (opts.failAddAfter !== undefined && adds > opts.failAddAfter) {
        throw new TypeError("fetch failed");
      }
      rec.documents.push({ driveId, ...doc });
      return `doc-${rec.documents.length}`;
    },
    async setProtection(driveId, isProtected) {
      if (opts.refuseProtection) {
        throw Object.assign(new Error("Forbidden: You must be an admin of this document"), {
          response: { status: 200 },
        });
      }
      rec.protection.push({ driveId, isProtected });
    },
  };
  return {
    rec,
    driveClient: async (endpoint: string) => {
      rec.endpoints.push(endpoint);
      return client;
    },
  };
}

describe("product drive (D21)", () => {
  let workdir: string;
  let project: string;
  const lines: string[] = [];

  function ctxWith(driveClient: ProductDriveContext["driveClient"]): ProductDriveContext {
    const log = (m: string) => {
      lines.push(m);
    };
    return {
      workdir,
      config: { cloudSwitchboardUrl: "https://cloud.example.test", environmentId: "studio-env-1" },
      log: { info: log, warn: log, error: log, debug: log },
      driveClient,
    };
  }

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "product-drive-"));
    project = path.join(workdir, "todo-app");
    await write(project, "document-models/todo-list/todo-list.json", TODO_MODEL);
    await write(project, "seed/todo-list.json", GOOD_SEED);
    lines.length = 0;
  });
  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it("creates the drive once and never again", async () => {
    const server = fakeServer();
    const ctx = ctxWith(server.driveClient);
    const opts = { switchboardUrl: SWITCHBOARD, name: "Todo App", projectPath: project };

    const first = await ensureProductDrive(ctx, { ...opts, appEditorId: "todo-board" });
    expect(first).toBe("drive-1");
    expect(server.rec.drives).toEqual(["drive-1"]);
    expect(server.rec.endpoints).toEqual([`${SWITCHBOARD}/graphql`]);
    expect(server.rec.configured).toEqual([
      { driveId: "drive-1", name: "Todo App", preferredEditor: "todo-board" },
    ]);
    // Q3 default: open to signed-in users (unprotected).
    expect(server.rec.protection).toEqual([{ driveId: "drive-1", isProtected: false }]);

    // A later launch (or a retry) without the stored id: no call at all.
    const again = await ensureProductDrive(ctx, opts);
    expect(again).toBe("drive-1");
    // Once the product document holds the id, nothing is even read.
    const known = await ensureProductDrive(ctx, { ...opts, knownDriveId: "drive-1" });
    expect(known).toBe("drive-1");

    expect(server.rec.drives).toHaveLength(1);
    expect(server.rec.documents).toHaveLength(2);
    expect(server.rec.endpoints).toHaveLength(1);
  });

  it("seeds example documents marked Example — delete me", async () => {
    const server = fakeServer();
    await ensureProductDrive(ctxWith(server.driveClient), {
      switchboardUrl: `${SWITCHBOARD}/graphql`,
      name: "Todo App",
      projectPath: project,
    });
    expect(server.rec.documents.map((d) => d.name)).toEqual([
      "Example — delete me: Weekend chores",
      "Example — delete me",
    ]);
    for (const doc of server.rec.documents) {
      expect(doc.name.startsWith(EXAMPLE_PREFIX)).toBe(true);
      expect(doc.driveId).toBe("drive-1");
      expect(doc.documentType).toBe("acme/todo-list");
    }
    expect(server.rec.documents[0].actions).toEqual([
      { type: "ADD_TODO", input: { id: "t1", title: "Buy milk", priority: "HIGH" }, scope: "global" },
      { type: "ADD_TODO", input: { id: "t2", title: "Water plants", priority: "LOW" }, scope: "global" },
      { type: "COMPLETE_TODO", input: { id: "t1" }, scope: "global" },
    ]);
    // No app view: no preferred editor.
    expect(server.rec.configured).toEqual([{ driveId: "drive-1", name: "Todo App" }]);
  });

  it("an interrupted seeding resumes on the same drive without repeating examples", async () => {
    const flaky = fakeServer({ failAddAfter: 1 });
    const opts = { switchboardUrl: SWITCHBOARD, name: "Todo App", projectPath: project };
    const err = await ensureProductDrive(ctxWith(flaky.driveClient), opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).code).toBe("CLOUD_UNAVAILABLE");
    expect(flaky.rec.documents).toHaveLength(1);

    const healthy = fakeServer();
    const id = await ensureProductDrive(ctxWith(healthy.driveClient), opts);
    expect(id).toBe("drive-1");
    expect(healthy.rec.drives).toEqual([]); // no second drive
    expect(healthy.rec.configured).toEqual([]); // already named
    expect(healthy.rec.documents.map((d) => [d.driveId, d.name])).toEqual([
      ["drive-1", "Example — delete me"],
    ]);
  });

  it("a refused example is skipped, the launch goes on", async () => {
    const server = fakeServer();
    const ctx = ctxWith(async (endpoint) => {
      const client = await server.driveClient(endpoint);
      return {
        ...client,
        addDocument: async (driveId, doc) => {
          if (doc.name.endsWith("chores")) {
            throw Object.assign(new Error("reducer said no"), { response: { status: 200 } });
          }
          return client.addDocument(driveId, doc);
        },
      };
    });
    const id = await ensureProductDrive(ctx, {
      switchboardUrl: SWITCHBOARD,
      name: "Todo App",
      projectPath: project,
    });
    expect(id).toBe("drive-1");
    expect(server.rec.documents.map((d) => d.name)).toEqual(["Example — delete me"]);
    expect(lines.some((l) => l.includes("skipped") && l.includes("Weekend chores"))).toBe(true);
  });

  it("a failed drive creation is a launch error with a plain reason", async () => {
    const ctx = ctxWith(async () => ({
      createDrive: async () => {
        throw new TypeError("fetch failed");
      },
      configureDrive: async () => undefined,
      addDocument: async () => "x",
      setProtection: async () => undefined,
    }));
    const err = await ensureProductDrive(ctx, { switchboardUrl: SWITCHBOARD, name: "Todo App" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).reason).toBe("your product's data space couldn't be set up");
    // Nothing recorded: the next try creates the drive.
    await expect(fs.access(path.join(workdir, ".ph", "product-drive.json"))).rejects.toThrow();
  });

  it("a server without document permissions still gets the drive (default access only warns)", async () => {
    const server = fakeServer({ refuseProtection: true });
    const id = await ensureProductDrive(ctxWith(server.driveClient), {
      switchboardUrl: SWITCHBOARD,
      name: "Todo App",
      projectPath: project,
    });
    expect(id).toBe("drive-1");
    expect(lines.some((l) => l.includes("default access not set"))).toBe(true);
  });

  it("setAccess toggles drive protection", async () => {
    const server = fakeServer();
    const ctx = ctxWith(server.driveClient);
    await setAccess(ctx, "OWNER_ONLY", { switchboardUrl: SWITCHBOARD, driveId: "drive-9" });
    await setAccess(ctx, "SIGNED_IN", { switchboardUrl: SWITCHBOARD, driveId: "drive-9" });
    expect(server.rec.protection).toEqual([
      { driveId: "drive-9", isProtected: true },
      { driveId: "drive-9", isProtected: false },
    ]);

    const refusing = fakeServer({ refuseProtection: true });
    const err = await setAccess(ctxWith(refusing.driveClient), "OWNER_ONLY", {
      switchboardUrl: SWITCHBOARD,
      driveId: "drive-9",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).code).toBe("ACCESS_REFUSED");
  });

  it("switchboardGraphqlEndpoint accepts a base URL or the endpoint", () => {
    expect(switchboardGraphqlEndpoint("https://x.vetra.io/")).toBe("https://x.vetra.io/graphql");
    expect(switchboardGraphqlEndpoint("https://x.vetra.io/graphql")).toBe("https://x.vetra.io/graphql");
  });

  it("cloudSetProductDrive records the drive on the App", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const ctx: ProductDriveContext = {
      workdir,
      config: { cloudSwitchboardUrl: "https://cloud.example.test", environmentId: "studio-env-1" },
      env: { [STUDIO_SECRET_ENV]: randomBytes(16).toString("hex") },
      bearerToken: async () => "bearer",
      fetch: async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ data: { setStudioProductDrive: { id: "app-1" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
    await cloudSetProductDrive(ctx, "app-1", "drive-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("setStudioProductDrive(appId: $appId, driveId: $driveId)");
    expect(calls[0].variables).toEqual({ appId: "app-1", driveId: "drive-1" });
  });

  describe("example documents in SMOKE", () => {
    const okBuild = async () => ({ success: true, output: "built" });

    it("valid examples pass", async () => {
      const v = validateSeeds(project);
      expect(v.problems).toEqual([]);
      expect(v.documents).toHaveLength(2);
      const r = await runSmoke(project, { build: okBuild });
      expect(r).toEqual({ kind: "SMOKE", passed: true, reason: "There are no screens to check." });
    });

    it("invalid seed fails SMOKE with the document name", async () => {
      await write(project, "seed/todo-list.json", {
        documentType: "acme/todo-list",
        documents: [
          {
            name: "Example — delete me: Groceries",
            actions: [{ type: "ADD_TODO", input: { id: "t1", priority: "URGENT" } }],
          },
        ],
      });
      const r = await runSmoke(project, { build: okBuild });
      expect(r.kind).toBe("SMOKE");
      expect(r.passed).toBe(false);
      expect(r.reason).toBe(`An example document doesn't fit the app: "Example — delete me: Groceries".`);
      expect(r.detail).toContain("seed/todo-list.json");
      expect(r.detail).toContain("ADD_TODO");
    });

    it.each([
      ["a name without the example mark", { name: "Groceries", actions: [] }, "must start with"],
      [
        "an unknown operation",
        { name: "Example — delete me: A", actions: [{ type: "DELETE_ALL", input: {} }] },
        "has no operation DELETE_ALL",
      ],
      [
        "an unknown input field",
        { name: "Example — delete me: B", actions: [{ type: "COMPLETE_TODO", input: { id: "t1", when: "now" } }] },
        "when",
      ],
      [
        "a wrong scope",
        { name: "Example — delete me: C", actions: [{ type: "COMPLETE_TODO", scope: "local", input: { id: "t1" } }] },
        "global operation",
      ],
    ])("refuses %s", async (_label, doc, needle) => {
      await write(project, "seed/todo-list.json", { documentType: "acme/todo-list", documents: [doc] });
      const v = validateSeeds(project);
      expect(v.documents).toEqual([]);
      expect(v.problems).toHaveLength(1);
      expect(v.problems[0].message).toContain(needle);
    });

    it("refuses an unknown document type and broken JSON", async () => {
      await write(project, "seed/other.json", { documentType: "acme/other", documents: [] });
      await write(project, "seed/broken.json", "{ not json");
      const v = validateSeeds(project);
      expect(v.problems.map((p) => p.file).sort()).toEqual(["seed/broken.json", "seed/other.json"]);
      expect(v.problems.find((p) => p.file === "seed/other.json")?.message).toContain(
        'unknown document type "acme/other"',
      );
      const r = await runSmoke(project, { build: okBuild });
      expect(r.passed).toBe(false);
      expect(r.reason).toContain("2 example documents don't fit the app");
    });

    it("a project with document types but no examples fails SMOKE", async () => {
      await fs.rm(path.join(project, "seed"), { recursive: true });
      const r = await runSmoke(project, { build: okBuild });
      expect(r).toMatchObject({ passed: false, reason: "There are no example documents yet." });
    });

    it("a project without document types needs no examples", async () => {
      await fs.rm(path.join(project, "seed"), { recursive: true });
      await fs.rm(path.join(project, "document-models"), { recursive: true });
      const r = await runSmoke(project, { build: okBuild });
      expect(r.passed).toBe(true);
    });
  });

  describe("the delegated-identity client", () => {
    interface Req {
      operationName?: string;
      query: string;
      variables: Record<string, unknown>;
      authorization?: string;
    }

    /** A stand-in for the live server's GraphQL endpoint. */
    function graphqlStub(): Promise<{ url: string; reqs: Req[]; close: () => Promise<void> }> {
      const reqs: Req[] = [];
      const docs = new Map<string, { documentType: string; name: string; revision: number }>();
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString()));
        req.on("end", () => {
          const parsed = JSON.parse(body) as Req;
          const op = parsed.operationName ?? /(?:mutation|query)\s+(\w+)/.exec(parsed.query)?.[1];
          reqs.push({ ...parsed, operationName: op, authorization: req.headers.authorization });
          const v = parsed.variables;
          const docFields = (id: string) => {
            const d = docs.get(id)!;
            return {
              id,
              slug: id,
              name: d.name,
              documentType: d.documentType,
              state: { global: { name: "" } },
              revisionsList: [{ scope: "global", revision: d.revision }],
              createdAtUtcIso: "2026-10-21T00:00:00.000Z",
              lastModifiedAtUtcIso: "2026-10-21T00:00:00.000Z",
            };
          };
          let data: unknown;
          switch (op) {
            case "CreateEmptyDocument": {
              const id = `doc-${docs.size + 1}`;
              docs.set(id, { documentType: String(v.documentType), name: "", revision: 0 });
              data = { createEmptyDocument: docFields(id) };
              break;
            }
            case "RenameDocument":
              docs.get(String(v.documentIdentifier))!.name = String(v.name);
              data = { renameDocument: docFields(String(v.documentIdentifier)) };
              break;
            case "GetDocument":
              data = { document: { childIds: [], document: docFields(String(v.identifier)) } };
              break;
            case "MutateDocument": {
              const d = docs.get(String(v.documentIdentifier))!;
              d.revision += (v.actions as unknown[]).length;
              data = { mutateDocument: docFields(String(v.documentIdentifier)) };
              break;
            }
            case "SetPreferredEditor":
              data = { setPreferredEditor: docFields(String(v.documentIdentifier)) };
              break;
            case "SetDocumentProtection":
              data = { setDocumentProtection: { documentId: v.documentIdOrSlug, protected: v.protected } };
              break;
            default:
              data = null;
          }
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ data }));
        });
      });
      return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address() as AddressInfo;
          resolve({
            url: `http://127.0.0.1:${port}/graphql`,
            reqs,
            close: () => new Promise((r) => server.close(() => r())),
          });
        });
      });
    }

    const signer = {
      user: { address: "0x00000000000000000000000000000000000000aa", networkId: "eip155", chainId: 1 },
      app: { name: "vetra-cli", key: "did:key:zAgent" },
      signAction: async () => ["ts", "hash", "prevStateHash", "0xsig"],
    } as unknown as ISigner;

    it("creates, names, seeds and protects as the agent, every action signed", async () => {
      const stub = await graphqlStub();
      try {
        const ctx = { ...ctxWith(undefined), bearerToken: async () => "bearer-xyz" };
        const client = await createDriveClient(ctx, stub.url, { signer });
        const driveId = await client.createDrive();
        await client.configureDrive(driveId, { name: "Todo App", preferredEditor: "todo-board" });
        const docId = await client.addDocument(driveId, {
          documentType: "acme/todo-list",
          name: "Example — delete me: Weekend chores",
          actions: [
            { type: "ADD_TODO", input: { id: "t1", title: "Buy milk", priority: "HIGH" }, scope: "global" },
            { type: "COMPLETE_TODO", input: { id: "t1" }, scope: "global" },
          ],
        });
        await client.setProtection(driveId, true);

        expect(driveId).toBe("doc-1");
        expect(docId).toBe("doc-2");
        expect(stub.reqs.every((r) => r.authorization === "Bearer bearer-xyz")).toBe(true);
        const ops = stub.reqs.map((r) => r.operationName);
        expect(ops).toEqual([
          "CreateEmptyDocument",
          "RenameDocument",
          "GetDocument",
          "GetDocument",
          "MutateDocument",
          "SetPreferredEditor",
          "CreateEmptyDocument",
          "RenameDocument",
          "GetDocument",
          "MutateDocument",
          "GetDocument",
          "MutateDocument",
          "SetDocumentProtection",
        ]);
        expect(stub.reqs[0].variables.documentType).toBe("powerhouse/document-drive");
        expect(stub.reqs[6].variables).toMatchObject({ documentType: "acme/todo-list", parentIdentifier: "doc-1" });
        const mutations = stub.reqs.filter((r) => r.operationName === "MutateDocument");
        const sent = mutations.map((m) => (m.variables.actions as Array<Record<string, unknown>>)[0]);
        expect(sent.map((a) => a.type)).toEqual(["SET_DRIVE_NAME", "ADD_TODO", "COMPLETE_TODO"]);
        for (const a of sent) {
          const context = a.context as { signer?: { user?: { address?: string }; signatures?: unknown[] } };
          expect(context.signer?.user?.address).toBe(signer.user!.address);
          expect(context.signer?.signatures).toHaveLength(1);
        }
        expect(stub.reqs.at(-1)!.variables).toEqual({ documentIdOrSlug: "doc-1", protected: true });
      } finally {
        await stub.close();
      }
    });
  });
});
