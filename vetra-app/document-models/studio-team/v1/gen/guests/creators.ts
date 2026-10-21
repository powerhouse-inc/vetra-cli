/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  InviteGuestInputSchema,
  RevokeGuestInputSchema,
} from "../schema/zod.js";
import type { InviteGuestInput, RevokeGuestInput } from "../types.js";
import type { InviteGuestAction, RevokeGuestAction } from "./actions.js";

export const inviteGuest = (input: InviteGuestInput) =>
  createAction<InviteGuestAction>(
    "INVITE_GUEST",
    { ...input },
    undefined,
    InviteGuestInputSchema,
    "global",
  );

export const revokeGuest = (input: RevokeGuestInput) =>
  createAction<RevokeGuestAction>(
    "REVOKE_GUEST",
    { ...input },
    undefined,
    RevokeGuestInputSchema,
    "global",
  );
