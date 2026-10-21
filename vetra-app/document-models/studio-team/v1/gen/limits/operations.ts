/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioTeamGlobalState } from "../types.js";
import type {
  ClearMemberLimitAction,
  SetMemberLimitAction,
} from "./actions.js";

export interface StudioTeamLimitsOperations {
  setMemberLimitOperation: (
    state: StudioTeamGlobalState,
    action: SetMemberLimitAction,
    dispatch?: SignalDispatch,
  ) => void;
  clearMemberLimitOperation: (
    state: StudioTeamGlobalState,
    action: ClearMemberLimitAction,
    dispatch?: SignalDispatch,
  ) => void;
}
