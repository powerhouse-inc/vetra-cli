/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  InitProductInputSchema,
  RenameProductInputSchema,
  SetAccessInputSchema,
} from "../schema/zod.js";
import type {
  InitProductInput,
  RenameProductInput,
  SetAccessInput,
} from "../types.js";
import type {
  InitProductAction,
  RenameProductAction,
  SetAccessAction,
} from "./actions.js";

export const initProduct = (input: InitProductInput) =>
  createAction<InitProductAction>(
    "INIT_PRODUCT",
    { ...input },
    undefined,
    InitProductInputSchema,
    "global",
  );

export const renameProduct = (input: RenameProductInput) =>
  createAction<RenameProductAction>(
    "RENAME_PRODUCT",
    { ...input },
    undefined,
    RenameProductInputSchema,
    "global",
  );

export const setAccess = (input: SetAccessInput) =>
  createAction<SetAccessAction>(
    "SET_ACCESS",
    { ...input },
    undefined,
    SetAccessInputSchema,
    "global",
  );
