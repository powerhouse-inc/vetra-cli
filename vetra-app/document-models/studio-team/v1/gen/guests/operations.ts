/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioTeamGlobalState } from "../types.js";
import type { InviteGuestAction, RevokeGuestAction } from "./actions.js";

export interface StudioTeamGuestsOperations {
  inviteGuestOperation: (
    state: StudioTeamGlobalState,
    action: InviteGuestAction,
    dispatch?: SignalDispatch,
  ) => void;
  revokeGuestOperation: (
    state: StudioTeamGlobalState,
    action: RevokeGuestAction,
    dispatch?: SignalDispatch,
  ) => void;
}
