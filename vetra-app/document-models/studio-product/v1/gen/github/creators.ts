/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  SetExternalChangesInputSchema,
  SetGithubInputSchema,
} from "../schema/zod.js";
import type { SetExternalChangesInput, SetGithubInput } from "../types.js";
import type { SetExternalChangesAction, SetGithubAction } from "./actions.js";

export const setGithub = (input: SetGithubInput) =>
  createAction<SetGithubAction>(
    "SET_GITHUB",
    { ...input },
    undefined,
    SetGithubInputSchema,
    "global",
  );

export const setExternalChanges = (input: SetExternalChangesInput) =>
  createAction<SetExternalChangesAction>(
    "SET_EXTERNAL_CHANGES",
    { ...input },
    undefined,
    SetExternalChangesInputSchema,
    "global",
  );
