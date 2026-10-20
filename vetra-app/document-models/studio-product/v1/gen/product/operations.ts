/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioProductGlobalState } from "../types.js";
import type {
  InitProductAction,
  RenameProductAction,
  SetAccessAction,
} from "./actions.js";

export interface StudioProductProductOperations {
  initProductOperation: (
    state: StudioProductGlobalState,
    action: InitProductAction,
    dispatch?: SignalDispatch,
  ) => void;
  renameProductOperation: (
    state: StudioProductGlobalState,
    action: RenameProductAction,
    dispatch?: SignalDispatch,
  ) => void;
  setAccessOperation: (
    state: StudioProductGlobalState,
    action: SetAccessAction,
    dispatch?: SignalDispatch,
  ) => void;
}
