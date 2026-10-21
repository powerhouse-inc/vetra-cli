/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  ClearMemberLimitInputSchema,
  SetMemberLimitInputSchema,
} from "../schema/zod.js";
import type { ClearMemberLimitInput, SetMemberLimitInput } from "../types.js";
import type {
  ClearMemberLimitAction,
  SetMemberLimitAction,
} from "./actions.js";

export const setMemberLimit = (input: SetMemberLimitInput) =>
  createAction<SetMemberLimitAction>(
    "SET_MEMBER_LIMIT",
    { ...input },
    undefined,
    SetMemberLimitInputSchema,
    "global",
  );

export const clearMemberLimit = (input: ClearMemberLimitInput) =>
  createAction<ClearMemberLimitAction>(
    "CLEAR_MEMBER_LIMIT",
    { ...input },
    undefined,
    ClearMemberLimitInputSchema,
    "global",
  );
