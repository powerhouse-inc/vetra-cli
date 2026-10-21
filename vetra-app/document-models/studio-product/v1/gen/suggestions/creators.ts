/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  DismissSuggestionInputSchema,
  SetSuggestionsInputSchema,
  UseSuggestionInputSchema,
} from "../schema/zod.js";
import type {
  DismissSuggestionInput,
  SetSuggestionsInput,
  UseSuggestionInput,
} from "../types.js";
import type {
  DismissSuggestionAction,
  SetSuggestionsAction,
  UseSuggestionAction,
} from "./actions.js";

export const setSuggestions = (input: SetSuggestionsInput) =>
  createAction<SetSuggestionsAction>(
    "SET_SUGGESTIONS",
    { ...input },
    undefined,
    SetSuggestionsInputSchema,
    "global",
  );

export const useSuggestion = (input: UseSuggestionInput) =>
  createAction<UseSuggestionAction>(
    "USE_SUGGESTION",
    { ...input },
    undefined,
    UseSuggestionInputSchema,
    "global",
  );

export const dismissSuggestion = (input: DismissSuggestionInput) =>
  createAction<DismissSuggestionAction>(
    "DISMISS_SUGGESTION",
    { ...input },
    undefined,
    DismissSuggestionInputSchema,
    "global",
  );
