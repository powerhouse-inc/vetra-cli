import { describe, expect, it } from "vitest";
import {
  IDEATION_TYPES,
  deployFollowAction,
  followAction,
  latestTouchedNavigable,
  previewFollowAction,
  sectionForDocumentType,
  type DocLike,
  type TouchedTarget,
} from "./auto-nav.js";
import { SPECIFY_TYPES } from "./specify/projects.js";

function doc(
  id: string,
  documentType: string,
  lastModifiedAtUtcIso: string | Date,
  name = id,
): DocLike {
  return { header: { id, name, documentType, lastModifiedAtUtcIso } };
}

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

describe("latestTouchedNavigable", () => {
  it("returns null for an empty drive", () => {
    expect(latestTouchedNavigable([])).toBeNull();
  });

  it("returns null when no navigable docs exist", () => {
    const docs = [
      doc("a", "powerhouse/chat-session", "2026-06-04T10:00:00.000Z"),
      doc("b", "custom/task", "2026-06-04T11:00:00.000Z"),
    ];
    expect(latestTouchedNavigable(docs)).toBeNull();
  });

  it("picks the most recently modified navigable doc", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("b", "powerhouse/problem-sheet", "2026-06-04T12:00:00.000Z", "Prob"),
      doc("c", "powerhouse/audience-sheet", "2026-06-04T11:00:00.000Z", "Aud"),
    ];
    expect(latestTouchedNavigable(docs)).toEqual({
      id: "b",
      documentType: "powerhouse/problem-sheet",
      name: "Prob",
      ts: new Date("2026-06-04T12:00:00.000Z").getTime(),
      section: "ideate",
    });
  });

  it("follows a document-model and reports section specify", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("m", "powerhouse/document-model", "2026-06-04T23:00:00.000Z", "Task"),
    ];
    expect(latestTouchedNavigable(docs)).toEqual({
      id: "m",
      documentType: "powerhouse/document-model",
      name: "Task",
      ts: new Date("2026-06-04T23:00:00.000Z").getTime(),
      section: "specify",
    });
  });

  it("follows a document-editor and reports section specify", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc(
        "e",
        "powerhouse/document-editor",
        "2026-06-04T23:00:00.000Z",
        "MyEditor",
      ),
    ];
    expect(latestTouchedNavigable(docs)).toEqual({
      id: "e",
      documentType: "powerhouse/document-editor",
      name: "MyEditor",
      ts: new Date("2026-06-04T23:00:00.000Z").getTime(),
      section: "specify",
    });
  });

  it("ignores non-navigable docs even if newer", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("z", "powerhouse/chat-session", "2026-06-04T23:00:00.000Z"), // newest but not navigable
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("a");
  });

  it("accepts Date instances as well as ISO strings", () => {
    const docs = [
      doc("a", "powerhouse/feature", new Date("2026-06-04T10:00:00.000Z")),
      doc("b", "powerhouse/feature", new Date("2026-06-04T13:00:00.000Z"), "B"),
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("b");
  });

  it("on equal timestamps prefers the later entry (newest appended)", () => {
    const t = "2026-06-04T10:00:00.000Z";
    const docs = [
      doc("a", "powerhouse/brand-sheet", t),
      doc("b", "powerhouse/problem-sheet", t),
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("b");
  });

  it("skips docs with an unparseable timestamp", () => {
    const docs = [
      doc("a", "powerhouse/brand-sheet", "2026-06-04T10:00:00.000Z", "Brand"),
      doc("bad", "powerhouse/feature", "not-a-date"),
    ];
    expect(latestTouchedNavigable(docs)?.id).toBe("a");
  });
});

function touched(id: string, ts: number): TouchedTarget {
  return {
    id,
    documentType: "powerhouse/brand-sheet",
    name: id,
    ts,
    section: "ideate",
  };
}

const followingView = {
  autoNavEnabled: true,
  userPinned: false,
  openDocId: null,
};

describe("followAction", () => {
  it("does nothing when there is no navigable doc", () => {
    expect(followAction(null, null, followingView)).toEqual({
      mark: null,
      open: null,
    });
  });

  it("does nothing when the newest touch is not newer than the mark", () => {
    const latest = touched("x", 100);
    expect(followAction(latest, { id: "x", ts: 100 }, followingView)).toEqual({
      mark: null,
      open: null,
    });
    expect(followAction(latest, { id: "y", ts: 200 }, followingView)).toEqual({
      mark: null,
      open: null,
    });
  });

  it("opens a newer touch on a doc that is not in view", () => {
    const latest = touched("x", 200);
    expect(followAction(latest, { id: "y", ts: 100 }, followingView)).toEqual({
      mark: { id: "x", ts: 200 },
      open: latest,
    });
  });

  it("does not re-open the doc already in view on a re-edit", () => {
    const latest = touched("x", 200);
    expect(
      followAction(
        latest,
        { id: "x", ts: 100 },
        { ...followingView, openDocId: "x" },
      ),
    ).toEqual({ mark: { id: "x", ts: 200 }, open: null });
  });

  it("re-opens a closed doc on its next touch", () => {
    // The mark already points at x (it was followed, then closed) — a newer
    // touch on x must bring it back even though it was the last doc touched.
    const latest = touched("x", 200);
    expect(followAction(latest, { id: "x", ts: 100 }, followingView)).toEqual({
      mark: { id: "x", ts: 200 },
      open: latest,
    });
  });

  it("advances the mark without opening while the toggle is off", () => {
    const latest = touched("x", 200);
    expect(
      followAction(
        latest,
        { id: "y", ts: 100 },
        { ...followingView, autoNavEnabled: false },
      ),
    ).toEqual({ mark: { id: "x", ts: 200 }, open: null });
  });

  it("advances the mark without opening while pinned", () => {
    const latest = touched("x", 200);
    expect(
      followAction(
        latest,
        { id: "y", ts: 100 },
        { ...followingView, userPinned: true },
      ),
    ).toEqual({ mark: { id: "x", ts: 200 }, open: null });
  });

  it("follows activity on a suppressed doc once re-armed", () => {
    // While pinned the agent worked on x (mark advanced to x@200). After
    // unpinning, a newer touch on x navigates — x is not the doc in view.
    const latest = touched("x", 300);
    expect(followAction(latest, { id: "x", ts: 200 }, followingView)).toEqual({
      mark: { id: "x", ts: 300 },
      open: latest,
    });
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
