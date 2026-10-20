import type { Node } from "@powerhousedao/shared/document-drive";
import type { Action } from "document-model";
import { describe, expect, it, vi } from "vitest";
import {
  canStartFromIdea,
  startProduct,
  type StartProductDeps,
  type StartProductDrive,
} from "./startProduct.js";

const PRODUCT_TYPE = "vetra/studio-product";
const CHAT_TYPE = "powerhouse/chat-session";

function drive(nodes: Node[] = [], id = "drive-1"): StartProductDrive {
  return { header: { id }, state: { global: { nodes } } };
}

function file(id: string, documentType: string): Node {
  return { id, name: id, kind: "file", documentType, parentFolder: null };
}

function setup(extra: Partial<StartProductDeps> = {}) {
  let ids = 0;
  const created: { name: string; type: string; id: string }[] = [];
  const dispatched: { id: string; actions: Action[] }[] = [];
  const deps: StartProductDeps = {
    addDocument: vi.fn((_driveId: string, name: string, type: string) => {
      const id = type === PRODUCT_TYPE ? "product-1" : "session-1";
      created.push({ name, type, id });
      return Promise.resolve({ id });
    }),
    dispatch: vi.fn((id: string, actions: Action[]) => {
      dispatched.push({ id, actions });
      return Promise.resolve();
    }),
    now: () => "2026-10-20T10:00:00.000Z",
    newId: () => `id-${++ids}`,
    ...extra,
  };
  return { deps, created, dispatched };
}

describe("startProduct", () => {
  it("startProduct creates product, session and first change and sends the idea", async () => {
    const { deps, created, dispatched } = setup();

    const result = await startProduct(
      { drive: drive(), idea: "  hotel breakfast orders for guests " },
      deps,
    );

    expect(result).toEqual({ productId: "product-1", sessionId: "session-1" });
    expect(created).toEqual([
      { name: "Session 1", type: CHAT_TYPE, id: "session-1" },
      {
        name: "Hotel breakfast orders for",
        type: PRODUCT_TYPE,
        id: "product-1",
      },
    ]);

    // Product first, then the message (which starts the agent).
    expect(dispatched.map((d) => d.id)).toEqual(["product-1", "session-1"]);
    const [init, start] = dispatched[0].actions;
    expect(init.type).toBe("INIT_PRODUCT");
    expect(init.input).toEqual({
      name: "Hotel breakfast orders for",
      idea: "hotel breakfast orders for guests",
      createdAt: "2026-10-20T10:00:00.000Z",
    });
    expect(start.type).toBe("START_CHANGE");
    expect(start.input).toEqual({
      id: "id-1",
      kind: "FIRST_BUILD",
      request: "hotel breakfast orders for guests",
      chatSessionId: "session-1",
      startedAt: "2026-10-20T10:00:00.000Z",
    });
    const [message] = dispatched[1].actions;
    expect(message.type).toBe("ADD_USER_MESSAGE");
    expect(message.input).toEqual({
      id: "id-2",
      content: [
        { id: "id-3", type: "TEXT", text: "hotel breakfast orders for guests" },
      ],
      createdAt: "2026-10-20T10:00:00.000Z",
    });
  });

  it("uses the given name over the placeholder", async () => {
    const { deps, dispatched } = setup();
    await startProduct(
      { drive: drive(), idea: "todo app", name: "Tasks" },
      deps,
    );
    expect(dispatched[0].actions[0].input).toMatchObject({ name: "Tasks" });
  });

  it("startProduct on a drive with a product starts nothing", async () => {
    const getDocument = vi.fn(() =>
      Promise.resolve({
        state: {
          global: {
            activeChangeId: "c1",
            changes: [{ id: "c1", chatSessionId: "session-9" }],
          },
        },
      } as never),
    );
    const { deps } = setup({ getDocument });

    const result = await startProduct(
      { drive: drive([file("product-7", PRODUCT_TYPE)]), idea: "todo app" },
      deps,
    );

    expect(result).toEqual({ productId: "product-7", sessionId: "session-9" });
    expect(deps.addDocument).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("returns an existing product without a readable conversation", async () => {
    const { deps } = setup();
    const result = await startProduct(
      { drive: drive([file("product-7", PRODUCT_TYPE)]), idea: "todo app" },
      deps,
    );
    expect(result).toEqual({ productId: "product-7", sessionId: "" });
  });

  it("joins a second start on the same drive instead of creating twice", async () => {
    const { deps } = setup();
    const d = drive([], "drive-2");
    const [a, b] = await Promise.all([
      startProduct({ drive: d, idea: "todo app" }, deps),
      startProduct({ drive: d, idea: "todo app" }, deps),
    ]);
    expect(a).toEqual(b);
    expect(deps.addDocument).toHaveBeenCalledTimes(2);
  });

  it("refuses an empty idea", async () => {
    const { deps } = setup();
    await expect(
      startProduct({ drive: drive([], "drive-3"), idea: "   " }, deps),
    ).rejects.toThrow("Describe your idea first.");
    expect(deps.addDocument).not.toHaveBeenCalled();
  });
});

describe("canStartFromIdea", () => {
  it("is true only for a drive with no product, conversation or project", () => {
    expect(canStartFromIdea(drive())).toBe(true);
    expect(canStartFromIdea(drive([file("x", "powerhouse/brand-sheet")]))).toBe(
      true,
    );
    expect(canStartFromIdea(drive([file("p", PRODUCT_TYPE)]))).toBe(false);
    expect(canStartFromIdea(drive([file("s", CHAT_TYPE)]))).toBe(false);
    expect(
      canStartFromIdea(drive([file("m", "powerhouse/document-model")])),
    ).toBe(false);
  });
});
