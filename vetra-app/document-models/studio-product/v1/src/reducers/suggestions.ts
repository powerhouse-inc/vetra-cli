import type { StudioProductSuggestionsOperations } from "document-models/studio-product/v1";
import {
  DuplicateSuggestionIdError,
  InvalidAfterVersionError,
  InvalidSuggestionCountError,
  InvalidSuggestionTextError,
  SuggestionNotFoundError,
  SuggestionNotOpenError,
} from "../../gen/suggestions/error.js";
import type { StudioProductState, Suggestion } from "../../gen/schema/types.js";
import { normalizeProduct } from "../normalize.js";
import {
  SUGGESTION_TEXT_MAX,
  SUGGESTIONS_MAX,
  SUGGESTIONS_MIN,
} from "../suggestions.js";

function findOpen(state: StudioProductState, id: string): Suggestion {
  const suggestion = state.suggestions.find((s) => s.id === id);
  if (!suggestion) {
    throw new SuggestionNotFoundError(`No suggestion "${id}" exists.`);
  }
  if (suggestion.status !== "OPEN") {
    throw new SuggestionNotOpenError(
      `Suggestion "${id}" is ${suggestion.status}, not OPEN.`,
    );
  }
  return suggestion;
}

export const studioProductSuggestionsOperations: StudioProductSuggestionsOperations =
  {
    setSuggestionsOperation(state, action) {
      normalizeProduct(state);
      const { afterVersion, items } = action.input;
      if (afterVersion < 1) {
        throw new InvalidAfterVersionError(
          `Suggestions follow version 1 or later, not ${afterVersion}.`,
        );
      }
      if (items.length < SUGGESTIONS_MIN || items.length > SUGGESTIONS_MAX) {
        throw new InvalidSuggestionCountError(
          `Give ${SUGGESTIONS_MIN} to ${SUGGESTIONS_MAX} suggestions, not ${items.length}.`,
        );
      }
      // Open ideas for the same version are replaced; every other one stays
      // (used and dismissed ones are the history that keeps ideas unique, and
      // review findings are owned by SET_REVIEW_SUGGESTIONS).
      const kept = state.suggestions.filter(
        (s) =>
          !(
            s.kind === "IDEA" &&
            s.status === "OPEN" &&
            s.afterVersion === afterVersion
          ),
      );
      const ids = new Set(kept.map((s) => s.id));
      const added: Suggestion[] = [];
      for (const item of items) {
        const text = item.text.trim();
        if (!text || text.length > SUGGESTION_TEXT_MAX) {
          throw new InvalidSuggestionTextError(
            `A suggestion is 1 to ${SUGGESTION_TEXT_MAX} characters long.`,
          );
        }
        if (ids.has(item.id)) {
          throw new DuplicateSuggestionIdError(
            `A suggestion "${item.id}" already exists.`,
          );
        }
        ids.add(item.id);
        added.push({
          id: item.id,
          text,
          afterVersion,
          status: "OPEN",
          kind: "IDEA",
          screenshot: null,
        });
      }
      state.suggestions = [...kept, ...added];
    },
    useSuggestionOperation(state, action) {
      normalizeProduct(state);
      findOpen(state, action.input.id).status = "USED";
    },
    dismissSuggestionOperation(state, action) {
      normalizeProduct(state);
      findOpen(state, action.input.id).status = "DISMISSED";
    },
  };
