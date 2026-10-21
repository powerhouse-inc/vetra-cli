/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AcceptSourceNoticeInput,
  KeepVariantInput,
  SetNotesEnabledInput,
  SetOriginInput,
  SetPublicSourceInput,
  SetReviewSuggestionsInput,
  SetUpstreamVersionInput,
  SetVariantStatusInput,
  StartVariantsInput,
} from "../types.js";

export type SetReviewSuggestionsAction = Action & {
  type: "SET_REVIEW_SUGGESTIONS";
  input: SetReviewSuggestionsInput;
};
export type StartVariantsAction = Action & {
  type: "START_VARIANTS";
  input: StartVariantsInput;
};
export type SetVariantStatusAction = Action & {
  type: "SET_VARIANT_STATUS";
  input: SetVariantStatusInput;
};
export type KeepVariantAction = Action & {
  type: "KEEP_VARIANT";
  input: KeepVariantInput;
};
export type SetOriginAction = Action & {
  type: "SET_ORIGIN";
  input: SetOriginInput;
};
export type SetUpstreamVersionAction = Action & {
  type: "SET_UPSTREAM_VERSION";
  input: SetUpstreamVersionInput;
};
export type SetNotesEnabledAction = Action & {
  type: "SET_NOTES_ENABLED";
  input: SetNotesEnabledInput;
};
export type AcceptSourceNoticeAction = Action & {
  type: "ACCEPT_SOURCE_NOTICE";
  input: AcceptSourceNoticeInput;
};
export type SetPublicSourceAction = Action & {
  type: "SET_PUBLIC_SOURCE";
  input: SetPublicSourceInput;
};

export type StudioProductIterateAction =
  | SetReviewSuggestionsAction
  | StartVariantsAction
  | SetVariantStatusAction
  | KeepVariantAction
  | SetOriginAction
  | SetUpstreamVersionAction
  | SetNotesEnabledAction
  | AcceptSourceNoticeAction
  | SetPublicSourceAction;
