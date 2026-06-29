import { describe, expect, it } from "vitest";
import {
  IDEATION_TYPES,
  deployFollowAction,
  editFollowAction,
  previewFollowAction,
  sectionForDocumentType,
  type EditMark,
} from "./auto-nav.js";
import type { OpenTarget } from "./ideation/types.js";
import { SPECIFY_TYPES } from "./specify/projects.js";

describe("sectionForDocumentType", () => {
  it("maps the five ideation sheet types to ideate", () => {
    expect([...IDEATION_TYPES].sort()).toEqual(
      [
        "powerhouse/audience-sheet",
        "powerhouse/brand-sheet",
        "powerhouse/feature",
        "powerhouse/problem-sheet",
        "powerhouse/work-breakdown-structure",
      ].sort(),
    );
    for (const type of IDEATION_TYPES) {
      expect(sectionForDocumentType(type)).toBe("ideate");
    }
  });

  it("maps all five builder spec types to specify", () => {
    expect([...SPECIFY_TYPES.keys()].sort()).toEqual(
      [
        "powerhouse/app",
        "powerhouse/document-editor",
        "powerhouse/document-model",
        "powerhouse/processor",
        "powerhouse/subgraph",
      ].sort(),
    );
    for (const type of SPECIFY_TYPES.keys()) {
      expect(sectionForDocumentType(type)).toBe("specify");
    }
  });

  it("maps everything else to null", () => {
    expect(sectionForDocumentType("powerhouse/chat-session")).toBeNull();
    expect(sectionForDocumentType("custom/task")).toBeNull();
  });
});

function target(
  id: string,
  documentType = "powerhouse/brand-sheet",
): OpenTarget {
  return { id, documentType, name: id };
}

describe("editFollowAction", () => {
  const view = { autoNavEnabled: true, userPinned: false, openDocId: null };

  it("does nothing while no session is resolved", () => {
    expect(
      editFollowAction(
        { sessionId: null, callId: "c1", target: target("x") },
        null,
        view,
      ),
    ).toEqual({ mark: null, open: null });
  });

  it("seeds on first observation of a session without opening", () => {
    expect(
      editFollowAction(
        { sessionId: "s1", callId: "c1", target: target("x") },
        null,
        view,
      ),
    ).toEqual({ mark: { sessionId: "s1", callId: "c1" }, open: null });
  });

  it("re-seeds on session switch without opening", () => {
    expect(
      editFollowAction(
        { sessionId: "s2", callId: "c9", target: target("y") },
        { sessionId: "s1", callId: "c1" },
        view,
      ),
    ).toEqual({ mark: { sessionId: "s2", callId: "c9" }, open: null });
  });

  it("does nothing while the session has no edit call", () => {
    expect(
      editFollowAction(
        { sessionId: "s1", callId: null, target: null },
        { sessionId: "s1", callId: null },
        view,
      ),
    ).toEqual({ mark: null, open: null });
  });

  it("does nothing when the edit call was already processed", () => {
    expect(
      editFollowAction(
        { sessionId: "s1", callId: "c1", target: target("x") },
        { sessionId: "s1", callId: "c1" },
        view,
      ),
    ).toEqual({ mark: null, open: null });
  });

  it("opens a navigable target on a new edit call", () => {
    expect(
      editFollowAction(
        { sessionId: "s1", callId: "c2", target: target("x") },
        { sessionId: "s1", callId: "c1" },
        view,
      ),
    ).toEqual({ mark: { sessionId: "s1", callId: "c2" }, open: target("x") });
  });

  it("advances the mark but does not open a non-navigable type", () => {
    expect(
      editFollowAction(
        {
          sessionId: "s1",
          callId: "c2",
          target: target("x", "powerhouse/chat-session"),
        },
        { sessionId: "s1", callId: "c1" },
        view,
      ),
    ).toEqual({ mark: { sessionId: "s1", callId: "c2" }, open: null });
  });

  it("does not re-open the doc already in view", () => {
    expect(
      editFollowAction(
        { sessionId: "s1", callId: "c2", target: target("x") },
        { sessionId: "s1", callId: "c1" },
        { ...view, openDocId: "x" },
      ),
    ).toEqual({ mark: { sessionId: "s1", callId: "c2" }, open: null });
  });

  it("advances the mark without opening while suppressed", () => {
    const next = { sessionId: "s1", callId: "c2", target: target("x") };
    const prev: EditMark = { sessionId: "s1", callId: "c1" };
    expect(
      editFollowAction(next, prev, { ...view, autoNavEnabled: false }),
    ).toEqual({ mark: { sessionId: "s1", callId: "c2" }, open: null });
    expect(editFollowAction(next, prev, { ...view, userPinned: true })).toEqual(
      { mark: { sessionId: "s1", callId: "c2" }, open: null },
    );
  });
});

describe("previewFollowAction", () => {
  const view = { autoNavEnabled: true, userPinned: false };

  it("does nothing while no session is resolved", () => {
    expect(
      previewFollowAction({ sessionId: null, callId: "c1" }, null, view),
    ).toEqual({ mark: null, navigate: false });
  });

  it("seeds on first observation of a session without navigating", () => {
    expect(
      previewFollowAction({ sessionId: "s1", callId: "c1" }, null, view),
    ).toEqual({ mark: { sessionId: "s1", callId: "c1" }, navigate: false });
  });

  it("re-seeds on session switch without navigating", () => {
    expect(
      previewFollowAction(
        { sessionId: "s2", callId: "c9" },
        { sessionId: "s1", callId: "c1" },
        view,
      ),
    ).toEqual({ mark: { sessionId: "s2", callId: "c9" }, navigate: false });
  });

  it("does nothing while the session has no show call", () => {
    expect(
      previewFollowAction(
        { sessionId: "s1", callId: null },
        { sessionId: "s1", callId: null },
        view,
      ),
    ).toEqual({ mark: null, navigate: false });
  });

  it("does nothing when the show call was already processed", () => {
    expect(
      previewFollowAction(
        { sessionId: "s1", callId: "c1" },
        { sessionId: "s1", callId: "c1" },
        view,
      ),
    ).toEqual({ mark: null, navigate: false });
  });

  it("navigates on a new show call", () => {
    expect(
      previewFollowAction(
        { sessionId: "s1", callId: "c2" },
        { sessionId: "s1", callId: "c1" },
        view,
      ),
    ).toEqual({ mark: { sessionId: "s1", callId: "c2" }, navigate: true });
  });

  it("navigates on the first show of a seeded session", () => {
    expect(
      previewFollowAction(
        { sessionId: "s1", callId: "c1" },
        { sessionId: "s1", callId: null },
        view,
      ),
    ).toEqual({ mark: { sessionId: "s1", callId: "c1" }, navigate: true });
  });

  it("advances the mark without navigating while suppressed", () => {
    const next = { sessionId: "s1", callId: "c2" };
    const prev = { sessionId: "s1", callId: "c1" };
    expect(
      previewFollowAction(next, prev, { ...view, autoNavEnabled: false }),
    ).toEqual({ mark: { sessionId: "s1", callId: "c2" }, navigate: false });
    expect(
      previewFollowAction(next, prev, { ...view, userPinned: true }),
    ).toEqual({ mark: { sessionId: "s1", callId: "c2" }, navigate: false });
  });
});

describe("deployFollowAction", () => {
  it("is the shared session-call follow decision (aliases previewFollowAction)", () => {
    // The deploy track is intentionally the same logic; guard against drift.
    expect(deployFollowAction).toBe(previewFollowAction);
  });
});
