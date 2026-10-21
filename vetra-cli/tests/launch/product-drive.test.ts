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
  productDriveSlug,
  setAccess,
  switchboardGraphqlEndpoint,
  type ProductDriveClient,
  type ProductDriveContext,
} from "../../src/launch/product-drive.js";
import { EXAMPLE_PREFIX, validateSeeds, type SeedAction } from "../../src/launch/seed.js";
import { cloudSetProductDrive, STUDIO_SECRET_ENV } from "../../src/launch/cloud-launch.js";
import { LaunchError } from "../../src/launch/errors.js";
import { runSmoke } from "../../src/product/smoke.js";
import { hasProductDoc } from "../../src/commands/reactor-project/check.js";
import { productHarness } from "../product/helpers.js";

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

interface FakeDoc {
  driveId: string;
  documentType: string;
  name: string;
  ops: SeedAction[];
}

interface Faults {
  /** The drive is created but the answer is lost (once). */
  loseCreateDriveAnswer?: boolean;
  /** The n-th applied action (1-based, counted over the run) lands but its answer is lost (once). */
  loseApplyAnswerAt?: number;
  /** The n-th created example document lands but its answer is lost (once). */
  loseCreateDocumentAnswerAt?: number;
  /** The server refuses protection changes. */
  refuseProtection?: boolean;
  /** Example names the server refuses. */
  refuseExample?: string;
}

const lost = () => new TypeError("fetch failed");
const refused = (msg: string) => Object.assign(new Error(msg), { response: { status: 200 } });

/** An in-memory live server; it outlives the clients made for it, like the real one. */
function fakeServer(faults: Faults = {}) {
  const drives = new Map<string, { slug: string; name: string; preferredEditor?: string }>();
  const docs = new Map<string, FakeDoc>();
  const protection: Array<{ driveId: string; isProtected: boolean }> = [];
  const endpoints: string[] = [];
  const calls: string[] = [];
  let applied = 0;
  let createdDocs = 0;
  const client: ProductDriveClient = {
    async findDrive(slug) {
      calls.push("findDrive");
      return [...drives.entries()].find(([, d]) => d.slug === slug)?.[0] ?? null;
    },
    async createDrive(input) {
      calls.push("createDrive");
      const id = `drive-${drives.size + 1}`;
      drives.set(id, input);
      if (faults.loseCreateDriveAnswer) {
        faults.loseCreateDriveAnswer = false;
        throw lost();
      }
      return id;
    },
    async listDocuments(driveId) {
      calls.push("listDocuments");
      return [...docs.entries()]
        .filter(([, d]) => d.driveId === driveId)
        .map(([id, d]) => ({ id, name: d.name, documentType: d.documentType }));
    },
    async createDocument(driveId, input) {
      calls.push("createDocument");
      const id = `doc-${docs.size + 1}`;
      docs.set(id, { driveId, ...input, ops: [] });
      createdDocs++;
      if (faults.loseCreateDocumentAnswerAt === createdDocs) {
        faults.loseCreateDocumentAnswerAt = undefined;
        throw lost();
      }
      return id;
    },
    async applyActions(documentId, actions) {
      calls.push("applyActions");
      const doc = docs.get(documentId)!;
      if (faults.refuseExample && doc.name === faults.refuseExample) throw refused("reducer said no");
      const seen: Record<string, number> = {};
      for (const a of actions) {
        const index = seen[a.scope] ?? 0;
        seen[a.scope] = index + 1;
        if (doc.ops.filter((o) => o.scope === a.scope).length > index) continue;
        doc.ops.push(a);
        applied++;
        if (faults.loseApplyAnswerAt === applied) {
          faults.loseApplyAnswerAt = undefined;
          throw lost();
        }
      }
    },
    async setProtection(driveId, isProtected) {
      calls.push("setProtection");
      if (faults.refuseProtection) throw refused("Forbidden: You must be an admin of this document");
      protection.push({ driveId, isProtected });
    },
  };
  return {
    drives,
    docs,
    protection,
    endpoints,
    calls,
    faults,
    driveClient: async (endpoint: string) => {
      endpoints.push(endpoint);
      return client;
    },
  };
}

describe("product drive (D21)", () => {
  let workdir: string;
  let project: string;
  const lines: string[] = [];
  const base = () => ({ appId: "app-1", switchboardUrl: SWITCHBOARD, name: "Todo App", projectPath: project });

  function ctxWith(driveClient: ProductDriveContext["driveClient"], dir = workdir): ProductDriveContext {
    const log = (m: string) => {
      lines.push(m);
    };
    return {
      workdir: dir,
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

    const first = await ensureProductDrive(ctx, { ...base(), appEditorId: "todo-board" });
    expect(first).toEqual({ driveId: "drive-1", accessApplied: true, failedExamples: [] });
    expect(server.endpoints).toEqual([`${SWITCHBOARD}/graphql`]);
    expect([...server.drives.values()]).toEqual([
      { slug: productDriveSlug("app-1"), name: "Todo App", preferredEditor: "todo-board" },
    ]);
    // Q3 default: open to signed-in users (unprotected).
    expect(server.protection).toEqual([{ driveId: "drive-1", isProtected: false }]);

    // A later launch (or a retry) without the stored id: no call at all.
    expect((await ensureProductDrive(ctx, base())).driveId).toBe("drive-1");
    // Once the product document holds the id, nothing is even read.
    expect((await ensureProductDrive(ctx, { ...base(), knownDriveId: "drive-1" })).driveId).toBe("drive-1");

    expect(server.drives.size).toBe(1);
    expect(server.docs.size).toBe(2);
    expect(server.endpoints).toHaveLength(1);
  });

  it("seeds example documents marked Example — delete me", async () => {
    const server = fakeServer();
    await ensureProductDrive(ctxWith(server.driveClient), {
      ...base(),
      switchboardUrl: `${SWITCHBOARD}/graphql`,
    });
    const docs = [...server.docs.values()];
    expect(docs.map((d) => d.name)).toEqual(["Example — delete me: Weekend chores", "Example — delete me"]);
    for (const doc of docs) {
      expect(doc.name.startsWith(EXAMPLE_PREFIX)).toBe(true);
      expect(doc.driveId).toBe("drive-1");
      expect(doc.documentType).toBe("acme/todo-list");
    }
    expect(docs[0].ops).toEqual([
      { type: "ADD_TODO", input: { id: "t1", title: "Buy milk", priority: "HIGH" }, scope: "global" },
      { type: "ADD_TODO", input: { id: "t2", title: "Water plants", priority: "LOW" }, scope: "global" },
      { type: "COMPLETE_TODO", input: { id: "t1" }, scope: "global" },
    ]);
    // No app view: no preferred editor.
    expect([...server.drives.values()][0].preferredEditor).toBeUndefined();
  });

  it("a lost answer to the drive creation never leads to a second drive", async () => {
    const server = fakeServer({ loseCreateDriveAnswer: true });
    const ctx = ctxWith(server.driveClient);
    const err = await ensureProductDrive(ctx, base()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).code).toBe("CLOUD_UNAVAILABLE");
    expect(server.drives.size).toBe(1); // it was created, the answer was lost

    const retry = await ensureProductDrive(ctx, base());
    expect(retry.driveId).toBe("drive-1");
    expect(server.drives.size).toBe(1);
    expect(server.docs.size).toBe(2);
  });

  it("a lost workdir adopts the drive by its slug and doesn't repeat its examples", async () => {
    const server = fakeServer();
    await ensureProductDrive(ctxWith(server.driveClient), base());
    await fs.rm(path.join(workdir, ".ph"), { recursive: true });

    const again = await ensureProductDrive(ctxWith(server.driveClient), base());
    expect(again.driveId).toBe("drive-1");
    expect(server.drives.size).toBe(1);
    expect(server.docs.size).toBe(2);
    expect([...server.docs.values()][0].ops).toHaveLength(3);
    expect(lines.some((l) => l.includes("found by its slug"))).toBe(true);
  });

  it("a lost answer mid-seed resumes on the same documents without repeating anything", async () => {
    // Answer lost for the 2nd operation of the first example, then for the 2nd example's creation.
    const server = fakeServer({ loseApplyAnswerAt: 2 });
    const ctx = ctxWith(server.driveClient);
    await expect(ensureProductDrive(ctx, base())).rejects.toBeInstanceOf(LaunchError);
    expect(server.docs.size).toBe(1);

    server.faults.loseCreateDocumentAnswerAt = 2;
    await expect(ensureProductDrive(ctx, base())).rejects.toBeInstanceOf(LaunchError);

    const result = await ensureProductDrive(ctx, base());
    expect(result).toEqual({ driveId: "drive-1", accessApplied: true, failedExamples: [] });
    expect(server.drives.size).toBe(1);
    const docs = [...server.docs.values()];
    expect(docs.map((d) => d.name)).toEqual(["Example — delete me: Weekend chores", "Example — delete me"]);
    expect(docs.map((d) => d.ops.length)).toEqual([3, 1]);
  });

  it("a refused example is recorded and reported, the launch goes on", async () => {
    const server = fakeServer({ refuseExample: "Example — delete me: Weekend chores" });
    const ctx = ctxWith(server.driveClient);
    const result = await ensureProductDrive(ctx, base());
    expect(result.failedExamples).toEqual(["Example — delete me: Weekend chores"]);
    expect(lines.some((l) => l.includes("refused") && l.includes("Weekend chores"))).toBe(true);
    const marker = JSON.parse(await fs.readFile(path.join(workdir, ".ph", "product-drive.json"), "utf-8")) as {
      examples: Array<{ name: string; status: string; error?: string }>;
    };
    expect(marker.examples.map((e) => [e.name, e.status])).toEqual([
      ["Example — delete me: Weekend chores", "failed"],
      ["Example — delete me", "done"],
    ]);
    expect(marker.examples[0].error).toBe("reducer said no");
    // Reported again on a later call, without new calls.
    const calls = server.calls.length;
    expect((await ensureProductDrive(ctx, base())).failedExamples).toEqual(["Example — delete me: Weekend chores"]);
    expect(server.calls.length).toBe(calls);
  });

  it("logs examples left out because they don't fit the models", async () => {
    await write(project, "seed/bad.json", { documentType: "acme/other", documents: [] });
    const server = fakeServer();
    await ensureProductDrive(ctxWith(server.driveClient), base());
    expect(lines.some((l) => l.includes("example left out") && l.includes("seed/bad.json"))).toBe(true);
    expect(server.docs.size).toBe(2);
  });

  it("a failed drive creation is a launch error with a plain reason", async () => {
    const server = fakeServer();
    const ctx = ctxWith(async (endpoint) => ({
      ...(await server.driveClient(endpoint)),
      createDrive: async () => {
        throw lost();
      },
    }));
    const err = await ensureProductDrive(ctx, base()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LaunchError);
    expect((err as LaunchError).reason).toBe("your product's data space couldn't be set up");
    // Nothing recorded: the next try looks the drive up again.
    await expect(fs.access(path.join(workdir, ".ph", "product-drive.json"))).rejects.toThrow();
  });

  it("a refused default access is reported, not recorded as applied, and retried", async () => {
    const server = fakeServer({ refuseProtection: true });
    const ctx = ctxWith(server.driveClient);
    const result = await ensureProductDrive(ctx, base());
    expect(result).toEqual({ driveId: "drive-1", accessApplied: false, failedExamples: [] });
    expect(server.docs.size).toBe(2); // the launch went on
    expect(lines.some((l) => l.includes("default access not applied"))).toBe(true);
    // Reported again until the requests trigger applies it.
    expect((await ensureProductDrive(ctx, base())).accessApplied).toBe(false);

    server.faults.refuseProtection = false;
    await setAccess(ctx, "SIGNED_IN", { switchboardUrl: SWITCHBOARD, driveId: "drive-1" });
    expect((await ensureProductDrive(ctx, base())).accessApplied).toBe(true);
    expect(
      (await ensureProductDrive(ctx, { ...base(), knownDriveId: "drive-1" })).accessApplied,
    ).toBe(true);
  });

  it("an interrupted run retries the refused default access before seeding", async () => {
    const server = fakeServer({ refuseProtection: true, loseApplyAnswerAt: 1 });
    const ctx = ctxWith(server.driveClient);
    await expect(ensureProductDrive(ctx, base())).rejects.toBeInstanceOf(LaunchError);
    server.faults.refuseProtection = false;
    const result = await ensureProductDrive(ctx, base());
    expect(result.accessApplied).toBe(true);
    expect(server.protection).toEqual([{ driveId: "drive-1", isProtected: false }]);
  });

  it("setAccess toggles drive protection", async () => {
    const server = fakeServer();
    const ctx = ctxWith(server.driveClient);
    await setAccess(ctx, "OWNER_ONLY", { switchboardUrl: SWITCHBOARD, driveId: "drive-9" });
    await setAccess(ctx, "SIGNED_IN", { switchboardUrl: SWITCHBOARD, driveId: "drive-9" });
    expect(server.protection).toEqual([
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

    it("in a product workspace, a project with document types but no examples fails SMOKE", async () => {
      await fs.rm(path.join(project, "seed"), { recursive: true });
      const r = await runSmoke(project, { build: okBuild, requireExamples: true });
      expect(r).toMatchObject({ passed: false, reason: "There are no example documents yet." });
    });

    it("without a product document, missing examples are a note and SMOKE passes", async () => {
      await fs.rm(path.join(project, "seed"), { recursive: true });
      const notes: string[] = [];
      const r = await runSmoke(project, { build: okBuild, requireExamples: false, notes });
      expect(r.passed).toBe(true);
      expect(notes).toEqual([expect.stringContaining("no example documents yet")]);
    });

    it("invalid examples fail SMOKE even without a product document", async () => {
      await write(project, "seed/todo-list.json", { documentType: "acme/todo-list", documents: [{ name: "Groceries", actions: [] }] });
      const r = await runSmoke(project, { build: okBuild, requireExamples: false });
      expect(r).toMatchObject({ passed: false, reason: 'An example document doesn\'t fit the app: "Groceries".' });
    });

    it("a screen that doesn't load is still reported when the examples fail too", async () => {
      await write(project, "editors/todo/editor.tsx", "export {};");
      await write(project, "seed/todo-list.json", { documentType: "acme/todo-list", documents: [{ name: "Groceries", actions: [] }] });
      const r = await runSmoke(project, {
        build: okBuild,
        previewUrl: "http://preview.test/",
        fetch: async () => new Response("<script>ErrorOverlay</script>", { status: 500 }),
      });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe("A screen didn't load: editors/todo/editor.tsx.");
      expect(r.detail).toContain("Groceries");
    });

    it("a project without document types needs no examples", async () => {
      await fs.rm(path.join(project, "seed"), { recursive: true });
      await fs.rm(path.join(project, "document-models"), { recursive: true });
      const r = await runSmoke(project, { build: okBuild, requireExamples: true });
      expect(r.passed).toBe(true);
    });

    it("examples are required only when the workspace has a product document (X27)", async () => {
      const withProduct = await productHarness({ product: true });
      const without = await productHarness({ product: false });
      try {
        expect(await hasProductDoc(withProduct.ctx)).toBe(true);
        expect(await hasProductDoc(without.ctx)).toBe(false);
        expect(await hasProductDoc({})).toBe(false); // one-shot CLI: no reactor
      } finally {
        await withProduct.kill();
        await without.kill();
      }
    }, 30_000);
  });

  describe("the delegated-identity client", () => {
    interface Req {
      operationName?: string;
      query: string;
      variables: Record<string, unknown>;
      authorization?: string;
    }

    interface StubDoc {
      slug: string;
      name: string;
      documentType: string;
      parentId: string | null;
      revision: number;
      meta?: unknown;
      state: unknown;
    }

    /** A stand-in for the live server's GraphQL endpoint. */
    function graphqlStub(): Promise<{ url: string; reqs: Req[]; docs: Map<string, StubDoc>; close: () => Promise<void> }> {
      const reqs: Req[] = [];
      const docs = new Map<string, StubDoc>();
      const fields = (id: string) => {
        const d = docs.get(id)!;
        return {
          id,
          slug: d.slug,
          name: d.name,
          documentType: d.documentType,
          meta: d.meta ?? null,
          state: d.state,
          revisionsList: [{ scope: "global", revision: d.revision }],
          createdAtUtcIso: "2026-10-21T00:00:00.000Z",
          lastModifiedAtUtcIso: "2026-10-21T00:00:00.000Z",
        };
      };
      const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString()));
        req.on("end", () => {
          const parsed = JSON.parse(body) as Req;
          const op = parsed.operationName ?? /(?:mutation|query)\s+(\w+)/.exec(parsed.query)?.[1];
          reqs.push({ ...parsed, operationName: op, authorization: req.headers.authorization });
          const v = parsed.variables;
          let data: unknown = null;
          switch (op) {
            case "FindDocuments": {
              const search = (v.search ?? {}) as { type?: string; parentId?: string };
              const items = [...docs.entries()]
                .filter(([, d]) => (!search.type || d.documentType === search.type) && (!search.parentId || d.parentId === search.parentId))
                .map(([id]) => fields(id));
              data = { findDocuments: { items, hasNextPage: false, hasPreviousPage: false, cursor: null } };
              break;
            }
            case "CreateDocument": {
              const doc = v.document as { header: { id: string; slug: string; name: string; documentType: string; meta?: unknown }; state: { global: unknown } };
              docs.set(doc.header.id, {
                slug: doc.header.slug,
                name: doc.header.name,
                documentType: doc.header.documentType,
                parentId: null,
                revision: 0,
                meta: doc.header.meta,
                state: { global: doc.state.global },
              });
              data = { createDocument: fields(doc.header.id) };
              break;
            }
            case "CreateEmptyDocument": {
              const id = `doc-${docs.size + 1}`;
              docs.set(id, {
                slug: id,
                name: "",
                documentType: String(v.documentType),
                parentId: (v.parentIdentifier as string | null) ?? null,
                revision: 0,
                state: { global: {} },
              });
              data = { createEmptyDocument: fields(id) };
              break;
            }
            case "RenameDocument":
              docs.get(String(v.documentIdentifier))!.name = String(v.name);
              data = { renameDocument: fields(String(v.documentIdentifier)) };
              break;
            case "GetDocument":
              data = { document: { childIds: [], document: fields(String(v.identifier)) } };
              break;
            case "MutateDocument": {
              docs.get(String(v.documentIdentifier))!.revision += (v.actions as unknown[]).length;
              data = { mutateDocument: fields(String(v.documentIdentifier)) };
              break;
            }
            case "SetDocumentProtection":
              data = { setDocumentProtection: { documentId: v.documentIdOrSlug, protected: v.protected } };
              break;
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
            docs,
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

    it("creates, seeds and protects as the agent, every action signed, nothing repeated", async () => {
      const stub = await graphqlStub();
      try {
        const ctx = { ...ctxWith(undefined), bearerToken: async () => "bearer-xyz" };
        const client = await createDriveClient(ctx, stub.url, { signer });
        const slug = productDriveSlug("app-1");
        expect(await client.findDrive(slug)).toBeNull();
        const driveId = await client.createDrive({ slug, name: "Todo App", preferredEditor: "todo-board" });
        expect(await client.findDrive(slug)).toBe(driveId);
        const drive = stub.docs.get(driveId)!;
        expect(drive).toMatchObject({
          slug,
          name: "Todo App",
          documentType: "powerhouse/document-drive",
          meta: { preferredEditor: "todo-board" },
          state: { global: { name: "Todo App" } },
        });

        const docId = await client.createDocument(driveId, {
          documentType: "acme/todo-list",
          name: "Example — delete me: Weekend chores",
        });
        expect(await client.listDocuments(driveId)).toEqual([
          { id: docId, name: "Example — delete me: Weekend chores", documentType: "acme/todo-list" },
        ]);
        const actions: SeedAction[] = [
          { type: "ADD_TODO", input: { id: "t1", title: "Buy milk", priority: "HIGH" }, scope: "global" },
          { type: "COMPLETE_TODO", input: { id: "t1" }, scope: "global" },
        ];
        await client.applyActions(docId, actions);
        await client.applyActions(docId, actions); // a retry sends nothing new
        await client.setProtection(driveId, true);

        expect(stub.reqs.every((r) => r.authorization === "Bearer bearer-xyz")).toBe(true);
        const mutations = stub.reqs.filter((r) => r.operationName === "MutateDocument");
        const sent = mutations.map((m) => (m.variables.actions as Array<Record<string, unknown>>)[0]);
        expect(sent.map((a) => a.type)).toEqual(["ADD_TODO", "COMPLETE_TODO"]);
        for (const a of sent) {
          expect(typeof a.timestampUtcMs).toBe("string");
          expect(Number.isNaN(Date.parse(String(a.timestampUtcMs)))).toBe(false);
          const context = a.context as { signer?: { user?: { address?: string }; signatures?: unknown[] } };
          expect(context.signer?.user?.address).toBe(signer.user!.address);
          expect(context.signer?.signatures).toHaveLength(1);
        }
        expect(stub.reqs.at(-1)!.variables).toEqual({ documentIdOrSlug: driveId, protected: true });
      } finally {
        await stub.close();
      }
    });
  });
});
