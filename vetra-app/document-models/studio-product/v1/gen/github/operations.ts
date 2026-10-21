/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioProductGlobalState } from "../types.js";
import type { SetExternalChangesAction, SetGithubAction } from "./actions.js";

export interface StudioProductGithubOperations {
  setGithubOperation: (
    state: StudioProductGlobalState,
    action: SetGithubAction,
    dispatch?: SignalDispatch,
  ) => void;
  setExternalChangesOperation: (
    state: StudioProductGlobalState,
    action: SetExternalChangesAction,
    dispatch?: SignalDispatch,
  ) => void;
}
