/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type { ClearMemberLimitInput, SetMemberLimitInput } from "../types.js";

export type SetMemberLimitAction = Action & {
  type: "SET_MEMBER_LIMIT";
  input: SetMemberLimitInput;
};
export type ClearMemberLimitAction = Action & {
  type: "CLEAR_MEMBER_LIMIT";
  input: ClearMemberLimitInput;
};

export type StudioTeamLimitsAction =
  SetMemberLimitAction | ClearMemberLimitAction;
