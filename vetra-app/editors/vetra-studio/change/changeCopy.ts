/**
 * The copy of a change to the live product (spec §5.6–§5.7), exact where the
 * spec gives it. Tests assert these strings.
 */
import type { Change, LaunchLineKind } from "document-models/studio-product";

/* ---------- the drawer (§5.6) ---------- */

export const CHANGE_SOMETHING = "Change something";
export const WHAT_SHOULD_CHANGE = "What should change?";
export const SEND = "Send";
export const CLOSE = "Close";
export const DISCARDED = "discarded";
export const CHANGE_NOT_SENT = "Couldn't send it. Try again.";

/** A past-changes group heading: "Version 3 — Added a Ready column". */
export function versionHeading(number: number, title: string): string {
  const plain = title.trim();
  return plain ? `Version ${number} — ${plain}` : `Version ${number}`;
}

/** Shown in the drawer once the change went live; the split then closes. */
export function versionIsLive(number: number): string {
  return `Version ${number} is live.`;
}

/* ---------- the split (§5.7) ---------- */

export const LIVE_LABEL = "Live — what your users see now";
export const PREVIEW_LABEL = "Preview — your change, not live yet";
export const OPEN_LIVE_APP = "Open the live app ↗";

/** The live pane when the live app can't be shown in a frame. */
export function liveUnchanged(version: number): string {
  return `Your users see Version ${version}. It stays as it is while you change things here.`;
}

/* ---------- the Ready bar (§5.7) ---------- */

export const READY_TO_GO_LIVE = "Ready to go live.";
export const CHECKS_PASSED = "checks passed";
export const MAKE_IT_LIVE = "Make it live";
export const KEEP_CHANGING = "Keep changing";
export const DISCARD = "Discard";
export const DISCARD_CONFIRM =
  "Throw away this change? Your live app isn't affected.";
export const THROW_IT_AWAY = "Throw it away";
export const KEEP_IT = "Keep it";
export const GOING_LIVE = "Going live…";
export const THROWING_AWAY = "Throwing this change away…";
export const LAUNCH_NOT_REQUESTED = "Couldn't make it live. Try again.";
export const DISCARD_NOT_REQUESTED = "Couldn't throw it away. Try again.";

/** F13: the change's title, else its request cut to 60 characters. */
export function changeTitle(change: Pick<Change, "title" | "request">): string {
  const title = change.title?.trim();
  if (title) return title;
  const request = change.request.trim();
  return request.length > 60 ? `${request.slice(0, 59).trimEnd()}…` : request;
}

/** The launch lines of §5.5 ("same four launch lines"); MIRROR waits for
 *  GitHub (M4) and is shown only once it does something. */
export function launchLineText(
  kind: LaunchLineKind,
  number: number,
  host: string,
): string {
  switch (kind) {
    case "SNAPSHOT":
      return `Saving version ${number}`;
    case "PUBLISH":
      return "Publishing your product";
    case "DEPLOY":
      return host
        ? `Starting your live app at ${host}`
        : "Starting your live app";
    case "VERIFY":
      return "Checking it's up";
    case "MIRROR":
      return "Saving to GitHub";
  }
}
