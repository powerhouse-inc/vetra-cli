/**
 * "Make it better" (spec §5.8): the agent's suggestions for the live version,
 * once per launch, as a gentle card on the live product view. Picking one
 * opens the change drawer with its text in the box (editable before
 * sending); × removes one for good; "Not now" puts the card away until the
 * next version goes live (localStorage, per Studio and version).
 */
import {
  currentSuggestions,
  type StudioProductState,
} from "document-models/studio-product";
import { useState } from "react";
import type { PickedSuggestion } from "./ChangeDrawer.js";
import {
  DISMISS_SUGGESTION,
  MAKE_IT_BETTER,
  NOT_NOW,
  SUGGESTION_NOT_DISMISSED,
} from "./changeCopy.js";

const PUT_AWAY_PREFIX = "vetra-studio:suggestions-seen:";

function putAwayKey(studioId: string, version: number): string {
  return `${PUT_AWAY_PREFIX}${studioId}:${version}`;
}

function putAwayBefore(studioId: string, version: number): boolean {
  try {
    return window.localStorage.getItem(putAwayKey(studioId, version)) === "1";
  } catch {
    // Blocked storage: the card shows again rather than never.
    return false;
  }
}

function markPutAway(studioId: string, version: number): void {
  try {
    window.localStorage.setItem(putAwayKey(studioId, version), "1");
  } catch {
    // Blocked storage: the card stays away for this visit only.
  }
}

export function SuggestionsCard({
  product,
  studioId,
  onPick,
  onDismiss,
}: {
  /** Normalised product state with a live version. */
  product: StudioProductState;
  /** The Studio (its drive): scopes "once per launch". */
  studioId: string;
  /** Opens the change drawer with the suggestion in the box. */
  onPick: (suggestion: PickedSuggestion) => void;
  /** Removes a suggestion (`DISMISS_SUGGESTION`). */
  onDismiss: (id: string) => Promise<unknown>;
}) {
  const version = product.liveVersion ?? null;
  const [awayFor, setAwayFor] = useState<number | null>(() =>
    version !== null && putAwayBefore(studioId, version) ? version : null,
  );
  const [error, setError] = useState<string | null>(null);
  const suggestions = currentSuggestions(product).slice(0, 3);
  if (version === null || awayFor === version || suggestions.length === 0) {
    return null;
  }

  const putAway = () => {
    markPutAway(studioId, version);
    setAwayFor(version);
  };

  return (
    <section
      aria-label={MAKE_IT_BETTER}
      data-card="suggestions"
      className="mx-4 mb-3 shrink-0 rounded-lg border border-border bg-card px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {MAKE_IT_BETTER}
        </h3>
        <button
          type="button"
          onClick={putAway}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          {NOT_NOW}
        </button>
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="inline-flex items-center rounded-full border border-border bg-background text-xs text-foreground"
          >
            <button
              type="button"
              data-card-suggestion={s.id}
              onClick={() => {
                // Picked: the card has done its job for this version.
                putAway();
                onPick({ id: s.id, text: s.text });
              }}
              className="rounded-l-full px-2.5 py-0.5 hover:bg-accent"
            >
              {s.text}
            </button>
            <button
              type="button"
              data-card-dismiss={s.id}
              aria-label={`${DISMISS_SUGGESTION}: ${s.text}`}
              title={DISMISS_SUGGESTION}
              onClick={() => {
                setError(null);
                onDismiss(s.id).catch(() => setError(SUGGESTION_NOT_DISMISSED));
              }}
              className="rounded-r-full px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span aria-hidden>×</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
