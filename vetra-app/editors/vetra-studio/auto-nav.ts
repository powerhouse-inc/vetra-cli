/**
 * Auto-navigation target selection (pure, unit-testable).
 *
 * Session-scoped follow decisions live here, all keyed on the selected chat
 * session so activity in other sessions never yanks the view:
 *   - `editFollowAction` — open the document the selected session's agent just
 *     created/updated (ideation sheets → IDEATE; builder spec types → SPECIFY).
 *   - `previewFollowAction` — switch to BUILD when the selected session surfaces
 *     a preview via `spec-preview-show`.
 *   - `deployFollowAction` — switch to DEPLOY on a new deploy call (aliased to
 *     the preview decision; same per-session new-callId rule).
 *
 * Decision logic lives here so it can be tested without a React renderer.
 */
import type { OpenTarget } from "./ideation/types.js";
import { SPECIFY_TYPES } from "./specify/projects.js";

/** The five ideation sheet types (the set `DocumentHost` can render inline). */
export const IDEATION_TYPES: ReadonlySet<string> = new Set([
  "powerhouse/brand-sheet",
  "powerhouse/problem-sheet",
  "powerhouse/audience-sheet",
  "powerhouse/feature",
  "powerhouse/work-breakdown-structure",
]);

/**
 * The section a document opens in, by type: ideation sheets → IDEATE,
 * builder spec types → SPECIFY. `null` = no inline editor for it (folders,
 * custom models) — not followable/openable. Single source of truth for
 * navigability: auto-nav follows exactly the non-null types.
 */
export function sectionForDocumentType(
  documentType: string,
): "ideate" | "specify" | null {
  if (IDEATION_TYPES.has(documentType)) return "ideate";
  if (SPECIFY_TYPES.has(documentType)) return "specify";
  return null;
}

/** The agent edit the session-scoped doc watcher last processed, per session. */
export type EditMark = { sessionId: string; callId: string | null };

/**
 * Decide whether the selected session's latest agent edit should open a
 * document. Mirrors `previewFollowAction`'s per-session seeding (switching to
 * or first observing a session never navigates — only a NEW edit does, keyed by
 * the tool-result `callId`) and the open guards of the old timestamp watcher
 * (toggle/pin suppress; a doc already in view doesn't re-jump). The mark
 * advances even when navigation is suppressed, so re-arming follows future
 * edits rather than replaying the last one. A non-navigable edited type
 * advances the mark but opens nothing, so we never jump back to an older
 * navigable doc.
 */
export function editFollowAction(
  next: {
    sessionId: string | null;
    callId: string | null;
    target: OpenTarget | null;
  },
  prev: EditMark | null,
  view: {
    autoNavEnabled: boolean;
    userPinned: boolean;
    openDocId: string | null;
  },
): { mark: EditMark | null; open: OpenTarget | null } {
  if (!next.sessionId) return { mark: null, open: null };
  if (!prev || prev.sessionId !== next.sessionId) {
    return {
      mark: { sessionId: next.sessionId, callId: next.callId },
      open: null,
    };
  }
  if (!next.callId || next.callId === prev.callId) {
    return { mark: null, open: null };
  }
  const mark = { sessionId: next.sessionId, callId: next.callId };
  if (!view.autoNavEnabled || view.userPinned) return { mark, open: null };
  if (
    !next.target ||
    sectionForDocumentType(next.target.documentType) === null ||
    next.target.id === view.openDocId
  ) {
    return { mark, open: null };
  }
  return { mark, open: next.target };
}

/** The spec-preview-show call the BUILD watcher last processed, per session. */
export type PreviewMark = { sessionId: string; callId: string | null };

/**
 * Decide whether a session's preview target should switch the view to BUILD.
 * Keyed on the show call's toolCallId: a re-show of the same target is a new
 * call and navigates again. Seeds per session (a target already in the
 * transcript at load/session-switch doesn't navigate). Like `editFollowAction`,
 * the mark advances when navigation is suppressed, so re-arming doesn't replay
 * an old show.
 */
export function previewFollowAction(
  next: { sessionId: string | null; callId: string | null },
  prev: PreviewMark | null,
  view: { autoNavEnabled: boolean; userPinned: boolean },
): { mark: PreviewMark | null; navigate: boolean } {
  if (!next.sessionId) return { mark: null, navigate: false };
  if (!prev || prev.sessionId !== next.sessionId) {
    return {
      mark: { sessionId: next.sessionId, callId: next.callId },
      navigate: false,
    };
  }
  if (!next.callId || next.callId === prev.callId) {
    return { mark: null, navigate: false };
  }
  const mark = { sessionId: next.sessionId, callId: next.callId };
  return { mark, navigate: view.autoNavEnabled && !view.userPinned };
}

/**
 * The DEPLOY follow track reuses the preview track's decision verbatim — both
 * are "a new tool call surfaced for this session → navigate, seeded per
 * session, mark advances when suppressed". Aliased (not duplicated) so the
 * deploy call site reads honestly while sharing one tested implementation.
 */
export const deployFollowAction = previewFollowAction;
export type DeployMark = PreviewMark;
