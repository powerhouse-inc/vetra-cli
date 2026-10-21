/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type { InviteGuestInput, RevokeGuestInput } from "../types.js";

export type InviteGuestAction = Action & {
  type: "INVITE_GUEST";
  input: InviteGuestInput;
};
export type RevokeGuestAction = Action & {
  type: "REVOKE_GUEST";
  input: RevokeGuestInput;
};

export type StudioTeamGuestsAction = InviteGuestAction | RevokeGuestAction;
