import type { Node } from "@powerhousedao/shared/document-drive";
import type { Action, PHDocument } from "document-model";
import {
  actions as productActions,
  reducer,
  utils,
  type StudioProductDocument,
} from "document-models/studio-product";
import { describe, expect, it, vi } from "vitest";
import type { StartProductDrive } from "../idea/startProduct.js";
import {
  CHANGE_LAUNCHING_TEXT,
  EMPTY_REQUEST_TEXT,
  startChange,
  type StartChangeDeps,
} from "./startChange.js";

const CHAT_TYPE = "powerhouse/chat-session";
const AT = "2026-10-21T10:00:00.000Z";

/**
 * A drive with a launched product (Version 1 live, its first build LAUNCHED)
 * and the first build's conversation. The product runs the real reducer;
 * conversations record the messages sent to them.
 */
function studio(productId = "product-1") {
  const nodes: Node[] = [
    {
      id: "session-1",
      name: "Session 1",
      kind: "file",
      documentType: CHAT_TYPE,
      parentFolder: null,
    },
    {
      id: productId,
      name: "Todo",
      kind: "file",
      documentType: "vetra/studio-product",
      parentFolder: null,
    },
  ];
  const drive: StartProductDrive = {
    header: { id: "drive-1" },
    state: { global: { nodes } },
  };
  let product: StudioProductDocument = utils.createDocument();
  const apply = (actions: Action[]) => {
    for (const action of actions) {
      const before = product.operations.global.length;
      product = reducer(product, action);
      const op = product.operations.global.at(before);
      if (op?.error) throw new Error(op.error);
    }
  };
  apply([
    productActions.initProduct({
      name: "Todo",
      idea: "todo app",
      createdAt: AT,
    }),
    productActions.startChange({
      id: "c1",
      kind: "FIRST_BUILD",
      request: "todo app",
      chatSessionId: "session-1",
      startedAt: AT,
    }),
    productActions.planSteps({
      changeId: "c1",
      steps: [
        { kind: "PLAN", total: null },
        { kind: "LIVE", total: null },
      ],
    }),
    productActions.completeStep({ changeId: "c1", kind: "PLAN", at: AT }),
    productActions.startLaunch({ changeId: "c1", number: 1, at: AT }),
  ]);
  const messages = new Map<string, string[]>([["session-1", ["todo app"]]]);
  const productDispatches: string[][] = [];
  let ids = 0;
  let failNext = false;
  const deps: StartChangeDeps = {
    addDocument: vi.fn((_driveId: string, name: string, type: string) => {
      const id = `session-${nodes.length}`;
      nodes.push({
        id,
        name,
        kind: "file",
        documentType: type,
        parentFolder: null,
      });
      messages.set(id, []);
      return Promise.resolve({ id });
    }),
    dispatch: vi.fn((id: string, actions: Action[]) => {
      if (failNext && id === productId) {
        failNext = false;
        return Promise.reject(new Error("dispatch failed"));
      }
      if (id === productId) {
        productDispatches.push(actions.map((a) => a.type));
        apply(actions);
      } else {
        for (const a of actions) {
          const input = a.input as { content: { text: string }[] };
          messages.get(id)!.push(input.content[0].text);
        }
      }
      return Promise.resolve();
    }),
    getDocument: (id: string) =>
      Promise.resolve(
        id === productId
          ? (product as unknown as PHDocument)
          : messages.has(id)
            ? ({
                header: { id },
                state: { global: { messages: messages.get(id) } },
              } as unknown as PHDocument)
            : undefined,
      ),
    now: () => AT,
    newId: () => `id-${++ids}`,
  };
  return {
    drive,
    deps,
    productId,
    messages,
    productDispatches,
    state: () => product.state.global,
    apply,
    failProductOnce: () => {
      failNext = true;
    },
  };
}

/** Finish the first launch: Version 1 is live and the first build LAUNCHED. */
function goLive(s: ReturnType<typeof studio>) {
  const version = s.state().versions[0];
  s.apply([
    productActions.completeLaunch({
      number: version.number,
      at: AT,
      deploymentId: "dep-1",
      sha: "sha-1",
      gitTag: "v1",
      title: "Todo",
      summary: null,
      changedFiles: [],
      packages: [],
      launchedBy: "vetra",
      trigger: "STUDIO_LAUNCH",
    }),
  ]);
}

describe("startChange", () => {
  it("a change gets its own conversation", async () => {
    const s = studio();
    goLive(s);

    const result = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "  Add a notes field ",
        kind: "CHANGE",
      },
      s.deps,
    );

    expect(result).toEqual({
      changeId: "id-1",
      sessionId: "session-2",
      joined: false,
    });
    // A new conversation, not the first build's.
    expect(s.deps.addDocument).toHaveBeenCalledWith(
      "drive-1",
      "Session 2",
      CHAT_TYPE,
    );
    expect(s.messages.get("session-2")).toEqual(["Add a notes field"]);
    expect(s.messages.get("session-1")).toEqual(["todo app"]);
    const state = s.state();
    expect(state.activeChangeId).toBe("id-1");
    expect(state.changes[1]).toMatchObject({
      id: "id-1",
      kind: "CHANGE",
      request: "Add a notes field",
      status: "BUILDING",
      chatSessionId: "session-2",
      chatSessionIds: ["session-2"],
      startedAt: AT,
    });
  });

  it("a second request while building joins the change", async () => {
    const s = studio();
    goLive(s);
    const first = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "Add a notes field",
        kind: "CHANGE",
      },
      s.deps,
    );

    const second = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "and make it optional",
        kind: "CHANGE",
      },
      s.deps,
    );

    expect(second).toEqual({
      changeId: first.changeId,
      sessionId: first.sessionId,
      joined: true,
    });
    expect(s.messages.get(first.sessionId)).toEqual([
      "Add a notes field",
      "and make it optional",
    ]);
    expect(s.state().changes).toHaveLength(2);
    expect(s.deps.addDocument).toHaveBeenCalledTimes(1);
  });

  it("Keep changing on a READY change continues its conversation", async () => {
    const s = studio();
    goLive(s);
    const { changeId, sessionId } = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "Add a notes field",
        kind: "CHANGE",
      },
      s.deps,
    );
    s.apply([
      productActions.planSteps({
        changeId,
        steps: [
          { kind: "PLAN", total: null },
          { kind: "LIVE", total: null },
        ],
      }),
      productActions.completeStep({ changeId, kind: "PLAN", at: AT }),
    ]);
    expect(s.state().changes[1].status).toBe("READY");

    const result = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "Also show it on the list",
        kind: "CHANGE",
      },
      s.deps,
    );
    expect(result).toEqual({ changeId, sessionId, joined: true });
    expect(s.messages.get(sessionId)).toHaveLength(2);
  });

  it("resumes a paused change before sending to it", async () => {
    const s = studio();
    goLive(s);
    const { changeId, sessionId } = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "Add a notes field",
        kind: "CHANGE",
      },
      s.deps,
    );
    s.apply([productActions.pauseChange({ changeId, at: AT })]);
    s.productDispatches.length = 0;

    await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "go on",
        kind: "CHANGE",
      },
      s.deps,
    );

    expect(s.productDispatches).toEqual([["RESUME_CHANGE"]]);
    expect(s.state().changes[1].status).toBe("BUILDING");
    expect(s.messages.get(sessionId)).toEqual(["Add a notes field", "go on"]);
  });

  it("a request after a discarded change starts a new change", async () => {
    const s = studio();
    goLive(s);
    const first = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "Add a notes field",
        kind: "CHANGE",
      },
      s.deps,
    );
    s.apply([
      productActions.discardChange({ changeId: first.changeId, at: AT }),
    ]);

    const undo = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "Undo 'Ready column' but keep existing data",
        kind: "UNDO",
      },
      s.deps,
    );

    expect(undo.joined).toBe(false);
    expect(undo.changeId).not.toBe(first.changeId);
    expect(undo.sessionId).not.toBe(first.sessionId);
    const changes = s.state().changes;
    expect(changes.map((c) => c.status)).toEqual([
      "LAUNCHED",
      "DISCARDED",
      "BUILDING",
    ]);
    expect(changes[2].kind).toBe("UNDO");
  });

  it("sends to a new conversation when the open change's one is gone", async () => {
    const s = studio();
    goLive(s);
    s.apply([
      productActions.startChange({
        id: "c2",
        kind: "CHANGE",
        request: "x",
        chatSessionId: "deleted",
        startedAt: AT,
      }),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await startChange(
      {
        drive: s.drive,
        productId: s.productId,
        request: "more",
        kind: "CHANGE",
      },
      s.deps,
    );

    expect(result).toEqual({
      changeId: "c2",
      sessionId: "session-2",
      joined: true,
    });
    expect(s.messages.get("session-2")).toEqual(["more"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refuses while a change is going live, an empty request and an unloaded product", async () => {
    const s = studio();
    // The first build is LAUNCHING.
    await expect(
      startChange(
        {
          drive: s.drive,
          productId: s.productId,
          request: "x",
          kind: "CHANGE",
        },
        s.deps,
      ),
    ).rejects.toThrow(CHANGE_LAUNCHING_TEXT);
    await expect(
      startChange(
        {
          drive: s.drive,
          productId: s.productId,
          request: "  ",
          kind: "CHANGE",
        },
        s.deps,
      ),
    ).rejects.toThrow(EMPTY_REQUEST_TEXT);
    await expect(
      startChange(
        { drive: s.drive, productId: "missing", request: "x", kind: "CHANGE" },
        s.deps,
      ),
    ).rejects.toThrow("still loading");
    expect(s.deps.addDocument).not.toHaveBeenCalled();
  });

  it("a retry after a failed start reuses the empty conversation", async () => {
    const s = studio();
    goLive(s);
    const input = {
      drive: s.drive,
      productId: s.productId,
      request: "Add a notes field",
      kind: "CHANGE" as const,
    };
    s.failProductOnce();
    await expect(startChange(input, s.deps)).rejects.toThrow("dispatch failed");
    expect(s.messages.get("session-2")).toEqual([]);

    const result = await startChange(input, s.deps);

    expect(result.sessionId).toBe("session-2");
    expect(s.deps.addDocument).toHaveBeenCalledTimes(1);
    expect(s.messages.get("session-2")).toEqual(["Add a notes field"]);
    expect(s.state().changes[1].chatSessionId).toBe("session-2");
  });

  it("joins a double submit instead of starting twice", async () => {
    const s = studio();
    goLive(s);
    const input = {
      drive: s.drive,
      productId: s.productId,
      request: "Add a notes field",
      kind: "CHANGE" as const,
    };
    const [x, y] = await Promise.all([
      startChange(input, s.deps),
      startChange(input, s.deps),
    ]);
    expect(x).toEqual(y);
    expect(s.state().changes).toHaveLength(2);
    expect(s.messages.get(x.sessionId)).toEqual(["Add a notes field"]);
  });
});
