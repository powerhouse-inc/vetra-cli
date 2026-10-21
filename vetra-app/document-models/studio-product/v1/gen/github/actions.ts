/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type { SetExternalChangesInput, SetGithubInput } from "../types.js";

export type SetGithubAction = Action & {
  type: "SET_GITHUB";
  input: SetGithubInput;
};
export type SetExternalChangesAction = Action & {
  type: "SET_EXTERNAL_CHANGES";
  input: SetExternalChangesInput;
};

export type StudioProductGithubAction =
  SetGithubAction | SetExternalChangesAction;
