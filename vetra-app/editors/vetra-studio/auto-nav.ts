/**
 * Auto-navigation target selection (pure, unit-testable).
 *
 * The studio follows the document the agent is currently working on: as the
 * agent creates AND fills in ideation sheets, the view tracks whichever sheet
 * was most recently touched. We key off the document headers'
 * `lastModifiedAtUtcIso` (creation bumps it too), so a burst of fast creations
 * followed by spaced-out edits walks the view through each sheet as it fills in
 * — rather than jumping straight to the last-created one.
 *
 * Decision logic lives here so it can be tested without a React renderer —
 * mirroring `hooks/useSessionPreviewTarget.ts`.
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

/** Minimal structural shape of a resolved document we read (a subset of
 * PHDocument). `useDocumentsInSelectedDrive()` returns these. */
export type DocLike = {
  header: {
    id: string;
    name: string;
    documentType: string;
    lastModifiedAtUtcIso: string | Date;
  };
};

/** An auto-nav candidate: an OpenTarget plus the modified-time (epoch ms) used
 * to decide whether it's newer than what we've already followed, and the
 * section the document opens in. */
export type TouchedTarget = OpenTarget & {
  ts: number;
  section: "ideate" | "specify";
};

function toMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** High-water mark of the newest touch the watcher has processed. */
export type FollowMark = { id: string; ts: number };

/** What the user is currently looking at, as the watcher needs it. */
export type FollowView = {
  autoNavEnabled: boolean;
  userPinned: boolean;
  /** Id of the document open inline, or null when a list/home is shown. */
  openDocId: string | null;
};

/**
 * Decide how the auto-follow watcher reacts to the newest touch. Returns the
 * mark to record (null = leave unchanged) and the target to open (null = stay
 * put). The mark advances even when navigation is suppressed (toggle off,
 * pinned) so re-arming follows future activity rather than replaying old
 * touches. Navigation is skipped only when the touched doc is the one
 * already open — a closed doc re-opens on its next touch.
 */
export function followAction(
  latest: TouchedTarget | null,
  prev: FollowMark | null,
  view: FollowView,
): { mark: FollowMark | null; open: TouchedTarget | null } {
  if (!latest) return { mark: null, open: null };
  if (latest.ts <= (prev?.ts ?? -1)) return { mark: null, open: null };
  const mark = { id: latest.id, ts: latest.ts };
  if (!view.autoNavEnabled || view.userPinned) return { mark, open: null };
  if (latest.id === view.openDocId) return { mark, open: null };
  return { mark, open: latest };
}

/** The spec-preview-show call the BUILD watcher last processed, per session. */
export type PreviewMark = { sessionId: string; callId: string | null };

/**
 * Decide whether a session's preview target should switch the view to BUILD.
 * Keyed on the show call's toolCallId: a re-show of the same target is a new
 * call and navigates again. Seeds per session (a target already in the
 * transcript at load/session-switch doesn't navigate). Like `followAction`,
 * the mark advances when navigation is suppressed, so re-arming doesn't
 * replay an old show.
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

/**
 * The navigable document most recently created-or-modified. Returns `null` when
 * the drive has no navigable documents. On ties the later entry in `docs` wins
 * (documents are appended in creation order, so this prefers the newest).
 */
export function latestTouchedNavigable(
  docs: readonly DocLike[],
): TouchedTarget | null {
  let best: TouchedTarget | null = null;
  for (const doc of docs) {
    const h = doc.header;
    const section = sectionForDocumentType(h.documentType);
    if (!section) continue;
    const ts = toMs(h.lastModifiedAtUtcIso);
    if (Number.isNaN(ts)) continue;
    if (!best || ts >= best.ts) {
      best = {
        id: h.id,
        documentType: h.documentType,
        name: h.name,
        ts,
        section,
      };
    }
  }
  return best;
}
