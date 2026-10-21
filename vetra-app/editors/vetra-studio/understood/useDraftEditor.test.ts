// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  removeThing,
  renameThing,
  type UnderstoodDraft,
} from "../../../shared/understood-draft.js";
import { render } from "../test-utils/render.js";
import { defectDraft } from "../test-utils/understoodFixtures.js";
import {
  DRAFT_HISTORY_LIMIT,
  draftHistoryReducer,
  useDraftEditor,
} from "./useDraftEditor.js";

describe("draftHistoryReducer", () => {
  it("applies an edit and undoes it", () => {
    const start = { draft: defectDraft(), past: [] };
    const renamed = draftHistoryReducer(start, {
      type: "apply",
      edit: (d) => renameThing(d, "t-defect", "Baumangel"),
    });
    expect(renamed.draft.things[0].name).toBe("Baumangel");
    expect(renamed.past).toHaveLength(1);
    const back = draftHistoryReducer(renamed, { type: "undo" });
    expect(back.draft).toBe(start.draft);
    expect(back.past).toHaveLength(0);
  });

  it("an edit that changes nothing is not a step", () => {
    const start = { draft: defectDraft(), past: [] };
    expect(draftHistoryReducer(start, { type: "apply", edit: (d) => d })).toBe(
      start,
    );
  });

  it("undo with nothing to undo keeps the draft", () => {
    const start = { draft: defectDraft(), past: [] };
    expect(draftHistoryReducer(start, { type: "undo" })).toBe(start);
  });

  it("keeps at most 50 steps", () => {
    let state = { draft: defectDraft(), past: [] as UnderstoodDraft[] };
    for (let i = 0; i < DRAFT_HISTORY_LIMIT + 10; i++) {
      state = draftHistoryReducer(state, {
        type: "apply",
        edit: (d) => renameThing(d, "t-defect", `Mangel ${i}`),
      });
    }
    expect(state.past).toHaveLength(DRAFT_HISTORY_LIMIT);
  });
});

describe("useDraftEditor", () => {
  it("remove then undo restores", () => {
    let editor: ReturnType<typeof useDraftEditor> | undefined;
    function Probe() {
      editor = useDraftEditor(defectDraft());
      return null;
    }
    render(createElement(Probe));
    expect(editor?.canUndo).toBe(false);
    act(() => editor?.apply((d) => removeThing(d, "t-site")));
    expect(editor?.draft.things.map((t) => t.id)).not.toContain("t-site");
    expect(editor?.draft.links).toHaveLength(1);
    expect(editor?.canUndo).toBe(true);
    act(() => editor?.undo());
    expect(editor?.draft.things.map((t) => t.id)).toContain("t-site");
    expect(editor?.draft.links).toHaveLength(2);
    expect(editor?.canUndo).toBe(false);
  });
});
