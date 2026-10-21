/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  InitProductInput,
  RenameProductInput,
  SetAccessInput,
} from "../types.js";

export type InitProductAction = Action & {
  type: "INIT_PRODUCT";
  input: InitProductInput;
};
export type RenameProductAction = Action & {
  type: "RENAME_PRODUCT";
  input: RenameProductInput;
};
export type SetAccessAction = Action & {
  type: "SET_ACCESS";
  input: SetAccessInput;
};

export type StudioProductProductAction =
  | InitProductAction
  | RenameProductAction
  | SetAccessAction;
