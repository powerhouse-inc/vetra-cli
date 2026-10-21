/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  DismissSuggestionInput,
  SetSuggestionsInput,
  UseSuggestionInput,
} from "../types.js";

export type SetSuggestionsAction = Action & {
  type: "SET_SUGGESTIONS";
  input: SetSuggestionsInput;
};
export type UseSuggestionAction = Action & {
  type: "USE_SUGGESTION";
  input: UseSuggestionInput;
};
export type DismissSuggestionAction = Action & {
  type: "DISMISS_SUGGESTION";
  input: DismissSuggestionInput;
};

export type StudioProductSuggestionsAction =
  SetSuggestionsAction | UseSuggestionAction | DismissSuggestionAction;
