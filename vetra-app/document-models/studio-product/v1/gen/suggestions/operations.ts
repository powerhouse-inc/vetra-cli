/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioProductGlobalState } from "../types.js";
import type {
  DismissSuggestionAction,
  SetSuggestionsAction,
  UseSuggestionAction,
} from "./actions.js";

export interface StudioProductSuggestionsOperations {
  setSuggestionsOperation: (
    state: StudioProductGlobalState,
    action: SetSuggestionsAction,
    dispatch?: SignalDispatch,
  ) => void;
  useSuggestionOperation: (
    state: StudioProductGlobalState,
    action: UseSuggestionAction,
    dispatch?: SignalDispatch,
  ) => void;
  dismissSuggestionOperation: (
    state: StudioProductGlobalState,
    action: DismissSuggestionAction,
    dispatch?: SignalDispatch,
  ) => void;
}
