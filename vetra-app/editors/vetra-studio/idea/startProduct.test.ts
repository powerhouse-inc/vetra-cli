import type { Node } from "@powerhousedao/shared/document-drive";
import type { Action, PHDocument } from "document-model";
import { describe, expect, it, vi } from "vitest";
import {
  ideaStartStatus,
  startProduct,
  type StartProductDeps,
  type StartProductDrive,
} from "./startProduct.js";

const PRODUCT_TYPE = "vetra/studio-product";
const CHAT_TYPE = "powerhouse/chat-session";
const AT = "2026-10-20T10:00:00.000Z";

type Global = Record<string, unknown> & {
  changes?: Record<string, unknown>[];
  messages?: Record<string, unknown>[];
};

function file(id: string, documentType: string): Node {
  return { id, name: id, kind: "file", documentType, parentFolder: null };
}

function doc(id: string, global: Global): PHDocument {
  return { header: { id }, state: { global } } as unknown as PHDocument;
}

/** An in-memory drive + reactor: addDocument adds a node, dispatch applies
 *  the few actions startProduct sends; `failOn` makes one action type fail. */
function store(driveId = "drive-1") {
  const nodes: Node[] = [];
  const docs = new Map<string, Global>();
  const drive: StartProductDrive = {
    header: { id: driveId },
    state: { global: { nodes } },
  };
  let ids = 0;
  let failOn: string | null = null;
  const created: { name: string; type: string }[] = [];
  const dispatched: { id: string; types: string[] }[] = [];

  const add = (id: string, type: string, global: Global) => {
    nodes.push(file(id, type));
    docs.set(id, global);
  };
  const deps: StartProductDeps = {
    addDocument: vi.fn((_driveId: string, name: string, type: string) => {
      if (failOn === `create:${type}`) {
        failOn = null;
        return Promise.reject(new Error("create failed"));
      }
      const id =
        type === PRODUCT_TYPE ? `product-${++ids}` : `session-${++ids}`;
      created.push({ name, type });
      add(id, type, type === PRODUCT_TYPE ? { changes: [] } : { messages: [] });
      return Promise.resolve({ id });
    }),
    dispatch: vi.fn((id: string, actions: Action[]) => {
      const types = actions.map((a) => a.type);
      if (failOn && types.includes(failOn)) {
        failOn = null;
        return Promise.reject(new Error(`${types.join(",")} failed`));
      }
      dispatched.push({ id, types });
      const g = docs.get(id)!;
      for (const a of actions) {
        const input = a.input as Record<string, unknown>;
        if (a.type === "INIT_PRODUCT") Object.assign(g, input);
        if (a.type === "START_CHANGE") {
          g.changes!.push({ ...input, status: "BUILDING" });
          g.activeChangeId = input.id;
        }
        if (a.type === "ADD_USER_MESSAGE") {
          g.messages!.push({ ...input, role: "USER" });
        }
      }
      return Promise.resolve();
    }),
    getDocument: (id: string) =>
      Promise.resolve(docs.has(id) ? doc(id, docs.get(id)!) : undefined),
    now: () => AT,
    newId: () => `id-${++ids}`,
  };
  const documents = () => [...docs].map(([id, g]) => doc(id, g));
  return {
    drive,
    deps,
    docs,
    add,
    created,
    dispatched,
    documents,
    failNext: (what: string) => {
      failOn = what;
    },
  };
}

describe("startProduct", () => {
  it("startProduct creates product, session and first change and sends the idea", async () => {
    const s = store();

    const result = await startProduct(
      { drive: s.drive, idea: "  hotel breakfast orders for guests " },
      s.deps,
    );

    expect(s.created).toEqual([
      { name: "Session 1", type: CHAT_TYPE },
      { name: "Hotel breakfast orders for", type: PRODUCT_TYPE },
    ]);
    expect(result).toEqual({ productId: "product-2", sessionId: "session-1" });
    // Product first, then the message (which starts the agent).
    expect(s.dispatched).toEqual([
      { id: "product-2", types: ["INIT_PRODUCT", "START_CHANGE"] },
      { id: "session-1", types: ["ADD_USER_MESSAGE"] },
    ]);
    const product = s.docs.get("product-2")!;
    expect(product).toMatchObject({
      name: "Hotel breakfast orders for",
      idea: "hotel breakfast orders for guests",
      createdAt: AT,
      activeChangeId: "id-3",
    });
    expect(product.changes![0]).toMatchObject({
      kind: "FIRST_BUILD",
      request: "hotel breakfast orders for guests",
      chatSessionId: "session-1",
      startedAt: AT,
    });
    expect(s.docs.get("session-1")!.messages![0]).toMatchObject({
      content: [{ type: "TEXT", text: "hotel breakfast orders for guests" }],
      createdAt: AT,
    });
    expect(ideaStartStatus(s.drive, s.documents())).toBe("started");
  });

  it("uses the given name over the placeholder", async () => {
    const s = store();
    await startProduct(
      { drive: s.drive, idea: "todo app", name: "Tasks" },
      s.deps,
    );
    expect(s.docs.get("product-2")).toMatchObject({ name: "Tasks" });
  });

  it("startProduct on a drive with a product starts nothing", async () => {
    const s = store();
    await startProduct({ drive: s.drive, idea: "todo app" }, s.deps);
    const before = s.dispatched.length;

    const again = await startProduct({ drive: s.drive, idea: "other" }, s.deps);

    expect(again).toEqual({ productId: "product-2", sessionId: "session-1" });
    expect(s.dispatched).toHaveLength(before);
    expect(s.created).toHaveLength(2);
  });

  it("resumes after only the session was created", async () => {
    const s = store();
    s.failNext(`create:${PRODUCT_TYPE}`);
    await expect(
      startProduct({ drive: s.drive, idea: "todo app" }, s.deps),
    ).rejects.toThrow("create failed");
    expect(ideaStartStatus(s.drive, s.documents())).toBe("idea");

    const result = await startProduct(
      { drive: s.drive, idea: "todo app" },
      s.deps,
    );

    // The empty session is reused, not a second one created.
    expect(s.created.filter((c) => c.type === CHAT_TYPE)).toHaveLength(1);
    expect(result.sessionId).toBe("session-1");
    expect(s.dispatched.map((d) => d.types)).toEqual([
      ["INIT_PRODUCT", "START_CHANGE"],
      ["ADD_USER_MESSAGE"],
    ]);
    expect(ideaStartStatus(s.drive, s.documents())).toBe("started");
  });

  it("resumes a product that was created but not initialised", async () => {
    const s = store();
    s.failNext("INIT_PRODUCT");
    await expect(
      startProduct({ drive: s.drive, idea: "todo app" }, s.deps),
    ).rejects.toThrow("failed");
    expect(ideaStartStatus(s.drive, s.documents())).toBe("idea");

    await startProduct({ drive: s.drive, idea: "todo app" }, s.deps);

    expect(s.created).toHaveLength(2);
    expect(s.dispatched.map((d) => d.types)).toEqual([
      ["INIT_PRODUCT", "START_CHANGE"],
      ["ADD_USER_MESSAGE"],
    ]);
    expect(ideaStartStatus(s.drive, s.documents())).toBe("started");
  });

  it("resumes a product and change whose first message was not sent", async () => {
    const s = store();
    s.failNext("ADD_USER_MESSAGE");
    await expect(
      startProduct({ drive: s.drive, idea: "todo app" }, s.deps),
    ).rejects.toThrow("failed");
    expect(ideaStartStatus(s.drive, s.documents())).toBe("idea");

    // The stored idea wins over what the box holds now.
    const result = await startProduct({ drive: s.drive, idea: "" }, s.deps);

    expect(result).toEqual({ productId: "product-2", sessionId: "session-1" });
    expect(s.dispatched.map((d) => d.types)).toEqual([
      ["INIT_PRODUCT", "START_CHANGE"],
      ["ADD_USER_MESSAGE"],
    ]);
    expect(s.docs.get("session-1")!.messages![0]).toMatchObject({
      content: [{ type: "TEXT", text: "todo app" }],
    });
  });

  it("joins a second start on the same drive instead of creating twice", async () => {
    const s = store("drive-2");
    const [a, b] = await Promise.all([
      startProduct({ drive: s.drive, idea: "todo app" }, s.deps),
      startProduct({ drive: s.drive, idea: "todo app" }, s.deps),
    ]);
    expect(a).toEqual(b);
    expect(s.created).toHaveLength(2);
  });

  it("refuses an empty idea", async () => {
    const s = store("drive-3");
    await expect(
      startProduct({ drive: s.drive, idea: "   " }, s.deps),
    ).rejects.toThrow("Describe your idea first.");
    expect(s.created).toHaveLength(0);
  });
});

describe("ideaStartStatus", () => {
  it("offers the idea box on a new drive and on one with only empty conversations", () => {
    const s = store();
    expect(ideaStartStatus(s.drive, [])).toBe("idea");
    s.add("x", "powerhouse/brand-sheet", {});
    s.add("s", CHAT_TYPE, { messages: [] });
    expect(ideaStartStatus(s.drive, s.documents())).toBe("idea");
  });

  it("keeps older Studios on today's page (F4)", () => {
    const withMessages = store();
    withMessages.add("s", CHAT_TYPE, { messages: [{ role: "USER" }] });
    expect(ideaStartStatus(withMessages.drive, withMessages.documents())).toBe(
      "legacy",
    );
    const withProject = store();
    withProject.add("m", "powerhouse/document-model", {});
    expect(ideaStartStatus(withProject.drive, withProject.documents())).toBe(
      "legacy",
    );
    // A conversation not loaded yet counts as used.
    const unloaded = store();
    unloaded.add("s", CHAT_TYPE, {});
    expect(ideaStartStatus(unloaded.drive, [])).toBe("legacy");
  });

  it("never offers a second first message while documents are syncing", () => {
    const s = store();
    s.add("p", PRODUCT_TYPE, {});
    // Product listed but not loaded.
    expect(ideaStartStatus(s.drive, [])).toBe("started");
    // Change linked to a listed session that is not loaded yet.
    s.docs.set("p", {
      activeChangeId: "c",
      changes: [{ id: "c", status: "BUILDING", chatSessionId: "s" }],
    });
    s.add("s", CHAT_TYPE, { messages: [] });
    const loaded = s.documents().filter((d) => d.header.id === "p");
    expect(ideaStartStatus(s.drive, loaded)).toBe("started");
    // Linked session not even listed yet: still resumable.
    s.docs.set("p", {
      activeChangeId: "c",
      changes: [{ id: "c", status: "BUILDING", chatSessionId: "gone" }],
    });
    expect(ideaStartStatus(s.drive, s.documents())).toBe("idea");
  });
});
