import type { Action, PHDocument } from "document-model";
import type { StudioProductDocument } from "document-models/studio-product";
import { describe, expect, it, vi } from "vitest";
import { drive, file } from "../test-utils/studioFixtures.js";
import {
  CHANGE_ID,
  CHANGE_SESSION,
  changingDoc,
  liveDoc,
} from "./changeFixtures.js";
import { startChange, type StartChangeDeps } from "./startChange.js";

const AT = "2026-10-20T11:00:00.000Z";

function deps(product: StudioProductDocument | undefined) {
  let ids = 0;
  const dispatched: { id: string; actions: Action[] }[] = [];
  const created: { name: string; type: string }[] = [];
  const d: StartChangeDeps = {
    addDocument: vi.fn((_drive: string, name: string, type: string) => {
      created.push({ name, type });
      return Promise.resolve({ id: "session-new" });
    }),
    dispatch: vi.fn((id: string, actions: Action[]) => {
      dispatched.push({ id, actions });
      return Promise.resolve();
    }),
    getDocument: vi.fn(() =>
      Promise.resolve(product as unknown as PHDocument | undefined),
    ),
    now: () => AT,
    newId: () => `id-${++ids}`,
  };
  return { d, dispatched, created };
}

const DRIVE = drive([file("session-1", "powerhouse/chat-session")]);

describe("startChange (F19)", () => {
  it("no change open: its own conversation, START_CHANGE, then the request", async () => {
    const { d, dispatched, created } = deps(liveDoc());
    const result = await startChange(
      {
        drive: DRIVE,
        productId: "product-1",
        request: "  Add a notes field ",
        kind: "CHANGE",
      },
      d,
    );
    expect(created).toEqual([
      { name: "Session 2", type: "powerhouse/chat-session" },
    ]);
    expect(result).toEqual({ changeId: "id-1", sessionId: "session-new" });
    expect(dispatched.map((x) => [x.id, x.actions.map((a) => a.type)])).toEqual(
      [
        ["product-1", ["START_CHANGE"]],
        ["session-new", ["ADD_USER_MESSAGE"]],
      ],
    );
    expect(dispatched[0].actions[0].input).toEqual({
      id: "id-1",
      kind: "CHANGE",
      request: "Add a notes field",
      chatSessionId: "session-new",
      startedAt: AT,
    });
  });

  it("a change in progress takes the request into its conversation", async () => {
    const { d, dispatched, created } = deps(changingDoc());
    const result = await startChange(
      {
        drive: DRIVE,
        productId: "product-1",
        request: "Also a due date",
        kind: "CHANGE",
      },
      d,
    );
    expect(result).toEqual({ changeId: CHANGE_ID, sessionId: CHANGE_SESSION });
    expect(created).toEqual([]);
    expect(dispatched.map((x) => [x.id, x.actions.map((a) => a.type)])).toEqual(
      [[CHANGE_SESSION, ["ADD_USER_MESSAGE"]]],
    );
  });

  it("refuses while a change goes live, without a request, or unreadable", async () => {
    const launching = changingDoc();
    launching.state.global.changes.find((c) => c.id === CHANGE_ID)!.status =
      "LAUNCHING";
    const input = {
      drive: DRIVE,
      productId: "product-1",
      request: "x",
      kind: "CHANGE" as const,
    };
    await expect(startChange(input, deps(launching).d)).rejects.toThrow(
      "Your change is going live. Try again in a moment.",
    );
    await expect(
      startChange({ ...input, request: "  " }, deps(liveDoc()).d),
    ).rejects.toThrow("Say what should change first.");
    await expect(startChange(input, deps(undefined).d)).rejects.toThrow(
      "Your product is still loading.",
    );
  });

  it("a double submit joins the first start", async () => {
    const { d, created } = deps(liveDoc());
    const input = {
      drive: DRIVE,
      productId: "product-1",
      request: "Add a notes field",
      kind: "CHANGE" as const,
    };
    const [a, b] = await Promise.all([
      startChange(input, d),
      startChange(input, d),
    ]);
    expect(a).toEqual(b);
    expect(created).toHaveLength(1);
  });
});
