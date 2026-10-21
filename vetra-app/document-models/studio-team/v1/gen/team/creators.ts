/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddReviewerInputSchema,
  ClearRoleOverrideInputSchema,
  InitTeamInputSchema,
  RemoveReviewerInputSchema,
  SetReviewRequiredInputSchema,
  SetRoleOverrideInputSchema,
} from "../schema/zod.js";
import type {
  AddReviewerInput,
  ClearRoleOverrideInput,
  InitTeamInput,
  RemoveReviewerInput,
  SetReviewRequiredInput,
  SetRoleOverrideInput,
} from "../types.js";
import type {
  AddReviewerAction,
  ClearRoleOverrideAction,
  InitTeamAction,
  RemoveReviewerAction,
  SetReviewRequiredAction,
  SetRoleOverrideAction,
} from "./actions.js";

export const initTeam = (input: InitTeamInput) =>
  createAction<InitTeamAction>(
    "INIT_TEAM",
    { ...input },
    undefined,
    InitTeamInputSchema,
    "global",
  );

export const setReviewRequired = (input: SetReviewRequiredInput) =>
  createAction<SetReviewRequiredAction>(
    "SET_REVIEW_REQUIRED",
    { ...input },
    undefined,
    SetReviewRequiredInputSchema,
    "global",
  );

export const addReviewer = (input: AddReviewerInput) =>
  createAction<AddReviewerAction>(
    "ADD_REVIEWER",
    { ...input },
    undefined,
    AddReviewerInputSchema,
    "global",
  );

export const removeReviewer = (input: RemoveReviewerInput) =>
  createAction<RemoveReviewerAction>(
    "REMOVE_REVIEWER",
    { ...input },
    undefined,
    RemoveReviewerInputSchema,
    "global",
  );

export const setRoleOverride = (input: SetRoleOverrideInput) =>
  createAction<SetRoleOverrideAction>(
    "SET_ROLE_OVERRIDE",
    { ...input },
    undefined,
    SetRoleOverrideInputSchema,
    "global",
  );

export const clearRoleOverride = (input: ClearRoleOverrideInput) =>
  createAction<ClearRoleOverrideAction>(
    "CLEAR_ROLE_OVERRIDE",
    { ...input },
    undefined,
    ClearRoleOverrideInputSchema,
    "global",
  );
