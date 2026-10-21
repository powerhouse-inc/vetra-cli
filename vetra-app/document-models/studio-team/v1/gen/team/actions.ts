/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddReviewerInput,
  ClearRoleOverrideInput,
  InitTeamInput,
  RemoveReviewerInput,
  SetReviewRequiredInput,
  SetRoleOverrideInput,
} from "../types.js";

export type InitTeamAction = Action & {
  type: "INIT_TEAM";
  input: InitTeamInput;
};
export type SetReviewRequiredAction = Action & {
  type: "SET_REVIEW_REQUIRED";
  input: SetReviewRequiredInput;
};
export type AddReviewerAction = Action & {
  type: "ADD_REVIEWER";
  input: AddReviewerInput;
};
export type RemoveReviewerAction = Action & {
  type: "REMOVE_REVIEWER";
  input: RemoveReviewerInput;
};
export type SetRoleOverrideAction = Action & {
  type: "SET_ROLE_OVERRIDE";
  input: SetRoleOverrideInput;
};
export type ClearRoleOverrideAction = Action & {
  type: "CLEAR_ROLE_OVERRIDE";
  input: ClearRoleOverrideInput;
};

export type StudioTeamTeamAction =
  | InitTeamAction
  | SetReviewRequiredAction
  | AddReviewerAction
  | RemoveReviewerAction
  | SetRoleOverrideAction
  | ClearRoleOverrideAction;
