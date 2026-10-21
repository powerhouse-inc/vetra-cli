import type { StudioProductState, Suggestion } from "../gen/schema/types.js";

/** A set of suggestions holds 2 to 3 ideas (spec §5.8). */
export const SUGGESTIONS_MIN = 2;
export const SUGGESTIONS_MAX = 3;
/** Each idea fits on a chip. */
export const SUGGESTION_TEXT_MAX = 80;

/**
 * The ideas to offer now: the open ones written for the live version (the
 * agent writes them in the Tests step for the version it is about to launch,
 * so they only appear once that version is live). Empty while nothing is live.
 */
export function currentSuggestions(state: StudioProductState): Suggestion[] {
  const live = state.liveVersion;
  if (live === null || live === undefined) return [];
  // Documents from earlier builds may have no list yet (F3).
  const partial: Partial<StudioProductState> = state;
  return (partial.suggestions ?? []).filter(
    (s) => s.status === "OPEN" && s.afterVersion === live,
  );
}
