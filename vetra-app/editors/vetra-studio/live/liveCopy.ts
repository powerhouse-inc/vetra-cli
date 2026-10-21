/**
 * The live product's copy (spec §5.5–§5.9), exact where the spec gives it.
 * The product document stores plain reasons only (F39); this file composes
 * the sentences around them, so the page and the agent never drift apart.
 */
import { agoText } from "../strip/stripModel.js";

/* ---------- arrival (§5.5) ---------- */

export const YOUR_PRODUCT_IS_LIVE = "Your product is live.";
export const ANYONE_WITH_THE_LINK =
  "Anyone with the link can sign in and use it.";
export const COPY_LINK = "Copy link";
export const LINK_COPIED = "Copied";
export const CHANGE_WHO_CAN_USE_IT = "Change who can use it";

/* ---------- the live surface (§5.6, D12) ---------- */

export const OPEN_IN_NEW_TAB = "Open in new tab ↗";

/** The fallback when the live app can't be shown in a frame (D12). */
export function previewLabel(version: number): string {
  return `Preview of Version ${version} — open the live app ↗`;
}

/** The live address without its scheme: "hotel-breakfast.vetra.io". */
export function liveHost(liveUrl: string | null): string {
  return liveUrl ? liveUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
}

/** "Went live 12 min ago" — a visit after the launch, instead of the banner. */
export function wentLiveAgo(liveSince: string | null, now: Date): string {
  return agoText("Went live", liveSince, now);
}

/* ---------- failures (§5.9) ---------- */

export const PERMISSION_NEEDED = "Your Studio needs your OK to publish.";
export const ALLOW = "Allow";
export const LIVE_UNHEALTHY =
  "Your live app isn't responding. We've been notified.";
export const RESTART = "Restart";
export const TRY_AGAIN = "Try again";
export const ASK_AGENT_TO_FIX = "Ask the agent to fix it";

/** "Go back to Version 2" (the version before the live one). */
export function goBackLabel(version: number): string {
  return `Go back to Version ${version}`;
}

/**
 * "Couldn't go live: <reason>. Your live app is still on Version <m>."
 * (F39 — the reason is the version's plain failure); a first launch never
 * had a version to keep.
 */
export function launchFailedText(
  reason: string,
  liveVersion: number | null,
): string {
  const plain = reason.trim().replace(/[.\s]+$/, "");
  const kept =
    liveVersion === null
      ? "Your app isn't live yet."
      : `Your live app is still on Version ${liveVersion}.`;
  return plain
    ? `Couldn't go live: ${plain}. ${kept}`
    : `Couldn't go live. ${kept}`;
}

/** What "Ask the agent to fix it" says in the failed change's conversation. */
export function askAgentMessage(reason: string): string {
  const plain = reason.trim().replace(/[.\s]+$/, "");
  return plain
    ? `The last launch failed: ${plain}. Please fix it so the version can go live.`
    : "The last launch failed. Please fix it so the version can go live.";
}
