/**
 * The draft being corrected on "What I understood", with undo. Every edit is
 * one of the pure edits from shared/understood-draft; the last 50 drafts are
 * kept so Undo (and Ctrl/⌘-Z) can step back.
 */
import { useCallback, useReducer } from "react";
import type { UnderstoodDraft } from "../../../shared/understood-draft.js";

export const DRAFT_HISTORY_LIMIT = 50;

export type DraftEdit = (draft: UnderstoodDraft) => UnderstoodDraft;

export type DraftHistory = {
  draft: UnderstoodDraft;
  past: UnderstoodDraft[];
};

export type DraftHistoryAction =
  { type: "apply"; edit: DraftEdit } | { type: "undo" };

export function draftHistoryReducer(
  state: DraftHistory,
  action: DraftHistoryAction,
): DraftHistory {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous
      ? { draft: previous, past: state.past.slice(0, -1) }
      : state;
  }
  const next = action.edit(state.draft);
  if (next === state.draft) return state;
  return {
    draft: next,
    past: [...state.past, state.draft].slice(-DRAFT_HISTORY_LIMIT),
  };
}

export function useDraftEditor(initial: UnderstoodDraft): {
  draft: UnderstoodDraft;
  apply: (edit: DraftEdit) => void;
  undo: () => void;
  canUndo: boolean;
} {
  const [state, dispatch] = useReducer(draftHistoryReducer, {
    draft: initial,
    past: [],
  });
  const apply = useCallback(
    (edit: DraftEdit) => dispatch({ type: "apply", edit }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  return {
    draft: state.draft,
    apply,
    undo,
    canUndo: state.past.length > 0,
  };
}
