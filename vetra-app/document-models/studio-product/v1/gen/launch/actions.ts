/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  ClearRequestInput,
  CompleteLaunchInput,
  FailLaunchInput,
  RequestDiscardInput,
  RequestLaunchInput,
  RequestMirrorInput,
  RequestRestartInput,
  RequestRollbackInput,
  SetHealthInput,
  SetLaunchLineInput,
  SetLaunchPermissionInput,
  SetLiveTargetInput,
  SetLiveVersionInput,
  SetProductDriveInput,
  StartLaunchInput,
} from "../types.js";

export type SetLiveTargetAction = Action & {
  type: "SET_LIVE_TARGET";
  input: SetLiveTargetInput;
};
export type SetProductDriveAction = Action & {
  type: "SET_PRODUCT_DRIVE";
  input: SetProductDriveInput;
};
export type RequestLaunchAction = Action & {
  type: "REQUEST_LAUNCH";
  input: RequestLaunchInput;
};
export type RequestRollbackAction = Action & {
  type: "REQUEST_ROLLBACK";
  input: RequestRollbackInput;
};
export type RequestDiscardAction = Action & {
  type: "REQUEST_DISCARD";
  input: RequestDiscardInput;
};
export type RequestRestartAction = Action & {
  type: "REQUEST_RESTART";
  input: RequestRestartInput;
};
export type RequestMirrorAction = Action & {
  type: "REQUEST_MIRROR";
  input: RequestMirrorInput;
};
export type ClearRequestAction = Action & {
  type: "CLEAR_REQUEST";
  input: ClearRequestInput;
};
export type StartLaunchAction = Action & {
  type: "START_LAUNCH";
  input: StartLaunchInput;
};
export type SetLaunchLineAction = Action & {
  type: "SET_LAUNCH_LINE";
  input: SetLaunchLineInput;
};
export type CompleteLaunchAction = Action & {
  type: "COMPLETE_LAUNCH";
  input: CompleteLaunchInput;
};
export type FailLaunchAction = Action & {
  type: "FAIL_LAUNCH";
  input: FailLaunchInput;
};
export type SetLiveVersionAction = Action & {
  type: "SET_LIVE_VERSION";
  input: SetLiveVersionInput;
};
export type SetHealthAction = Action & {
  type: "SET_HEALTH";
  input: SetHealthInput;
};
export type SetLaunchPermissionAction = Action & {
  type: "SET_LAUNCH_PERMISSION";
  input: SetLaunchPermissionInput;
};

export type StudioProductLaunchAction =
  | SetLiveTargetAction
  | SetProductDriveAction
  | RequestLaunchAction
  | RequestRollbackAction
  | RequestDiscardAction
  | RequestRestartAction
  | RequestMirrorAction
  | ClearRequestAction
  | StartLaunchAction
  | SetLaunchLineAction
  | CompleteLaunchAction
  | FailLaunchAction
  | SetLiveVersionAction
  | SetHealthAction
  | SetLaunchPermissionAction;
