/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioTeamGlobalState } from "../types.js";
import type {
  AddReviewerAction,
  ClearRoleOverrideAction,
  InitTeamAction,
  RemoveReviewerAction,
  SetReviewRequiredAction,
  SetRoleOverrideAction,
} from "./actions.js";

export interface StudioTeamTeamOperations {
  initTeamOperation: (
    state: StudioTeamGlobalState,
    action: InitTeamAction,
    dispatch?: SignalDispatch,
  ) => void;
  setReviewRequiredOperation: (
    state: StudioTeamGlobalState,
    action: SetReviewRequiredAction,
    dispatch?: SignalDispatch,
  ) => void;
  addReviewerOperation: (
    state: StudioTeamGlobalState,
    action: AddReviewerAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeReviewerOperation: (
    state: StudioTeamGlobalState,
    action: RemoveReviewerAction,
    dispatch?: SignalDispatch,
  ) => void;
  setRoleOverrideOperation: (
    state: StudioTeamGlobalState,
    action: SetRoleOverrideAction,
    dispatch?: SignalDispatch,
  ) => void;
  clearRoleOverrideOperation: (
    state: StudioTeamGlobalState,
    action: ClearRoleOverrideAction,
    dispatch?: SignalDispatch,
  ) => void;
}
