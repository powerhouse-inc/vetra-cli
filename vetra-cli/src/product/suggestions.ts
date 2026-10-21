/**
 * Agent suggestions (spec §5.8): after each launch the product offers 2–3
 * small ideas for the next change. The agent writes them with
 * `product-progress suggest` at the end of the Tests step; they are stored
 * for the version being launched and shown once it is live.
 */
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import { nextVersionNumber } from "../launch/orchestrator.js";
import { IN_PROGRESS, activeChange } from "./product-doc.js";

/** Mirrors the reducer: a set holds 2 to 3 ideas of at most 80 characters. */
export const SUGGESTIONS_MIN = 2;
export const SUGGESTIONS_MAX = 3;
export const SUGGESTION_TEXT_MAX = 80;

/** A shorter idea counts as the same as a longer one only from this length on. */
const CONTAINED_MIN = 12;

/** Lower case, letters and digits only, single spaces. */
export function ideaKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when two ideas say the same thing: equal, or one holds the other in whole words. */
export function sameIdea(a: string, b: string): boolean {
  const x = ideaKey(a);
  const y = ideaKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= CONTAINED_MIN && ` ${long} `.includes(` ${short} `);
}

/** Ideas the customer threw away: discarded changes (request and title) and dismissed suggestions. */
export function discardedIdeas(state: StudioProductState): string[] {
  const fromChanges = (state.changes ?? [])
    .filter((c) => c.status === "DISCARDED")
    .flatMap((c) => [c.request, c.title ?? ""]);
  const dismissed = (state.suggestions ?? []).filter((s) => s.status === "DISMISSED").map((s) => s.text);
  return [...fromChanges, ...dismissed].filter((t) => t.trim());
}

/**
 * The version a new set of suggestions belongs to: during a change, the
 * version it will launch as (the one launching, else the next number); once
 * the change is live, the live version. Null when nothing is being built or live.
 */
export function suggestionVersion(state: StudioProductState): number | null {
  const change = activeChange(state);
  if (change && IN_PROGRESS.includes(change.status)) {
    const launching = state.versions.find((v) => v.changeId === change.id && v.status === "LAUNCHING");
    return launching?.number ?? nextVersionNumber(state).number;
  }
  return state.liveVersion ?? null;
}
