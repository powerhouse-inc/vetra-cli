/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AcceptSourceNoticeInputSchema,
  KeepVariantInputSchema,
  SetNotesEnabledInputSchema,
  SetOriginInputSchema,
  SetPublicSourceInputSchema,
  SetReviewSuggestionsInputSchema,
  SetUpstreamVersionInputSchema,
  SetVariantStatusInputSchema,
  StartVariantsInputSchema,
} from "../schema/zod.js";
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
import type {
  AcceptSourceNoticeAction,
  KeepVariantAction,
  SetNotesEnabledAction,
  SetOriginAction,
  SetPublicSourceAction,
  SetReviewSuggestionsAction,
  SetUpstreamVersionAction,
  SetVariantStatusAction,
  StartVariantsAction,
} from "./actions.js";

export const setReviewSuggestions = (input: SetReviewSuggestionsInput) =>
  createAction<SetReviewSuggestionsAction>(
    "SET_REVIEW_SUGGESTIONS",
    { ...input },
    undefined,
    SetReviewSuggestionsInputSchema,
    "global",
  );

export const startVariants = (input: StartVariantsInput) =>
  createAction<StartVariantsAction>(
    "START_VARIANTS",
    { ...input },
    undefined,
    StartVariantsInputSchema,
    "global",
  );

export const setVariantStatus = (input: SetVariantStatusInput) =>
  createAction<SetVariantStatusAction>(
    "SET_VARIANT_STATUS",
    { ...input },
    undefined,
    SetVariantStatusInputSchema,
    "global",
  );

export const keepVariant = (input: KeepVariantInput) =>
  createAction<KeepVariantAction>(
    "KEEP_VARIANT",
    { ...input },
    undefined,
    KeepVariantInputSchema,
    "global",
  );

export const setOrigin = (input: SetOriginInput) =>
  createAction<SetOriginAction>(
    "SET_ORIGIN",
    { ...input },
    undefined,
    SetOriginInputSchema,
    "global",
  );

export const setUpstreamVersion = (input: SetUpstreamVersionInput) =>
  createAction<SetUpstreamVersionAction>(
    "SET_UPSTREAM_VERSION",
    { ...input },
    undefined,
    SetUpstreamVersionInputSchema,
    "global",
  );

export const setNotesEnabled = (input: SetNotesEnabledInput) =>
  createAction<SetNotesEnabledAction>(
    "SET_NOTES_ENABLED",
    { ...input },
    undefined,
    SetNotesEnabledInputSchema,
    "global",
  );

export const acceptSourceNotice = (input: AcceptSourceNoticeInput) =>
  createAction<AcceptSourceNoticeAction>(
    "ACCEPT_SOURCE_NOTICE",
    { ...input },
    undefined,
    AcceptSourceNoticeInputSchema,
    "global",
  );

export const setPublicSource = (input: SetPublicSourceInput) =>
  createAction<SetPublicSourceAction>(
    "SET_PUBLIC_SOURCE",
    { ...input },
    undefined,
    SetPublicSourceInputSchema,
    "global",
  );
