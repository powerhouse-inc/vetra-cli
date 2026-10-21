/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  ClearRequestInputSchema,
  CompleteLaunchInputSchema,
  FailLaunchInputSchema,
  RequestDiscardInputSchema,
  RequestLaunchInputSchema,
  RequestMirrorInputSchema,
  RequestRestartInputSchema,
  RequestRollbackInputSchema,
  SetHealthInputSchema,
  SetLaunchLineInputSchema,
  SetLaunchPermissionInputSchema,
  SetLiveTargetInputSchema,
  SetLiveVersionInputSchema,
  SetProductDriveInputSchema,
  StartLaunchInputSchema,
} from "../schema/zod.js";
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
import type {
  ClearRequestAction,
  CompleteLaunchAction,
  FailLaunchAction,
  RequestDiscardAction,
  RequestLaunchAction,
  RequestMirrorAction,
  RequestRestartAction,
  RequestRollbackAction,
  SetHealthAction,
  SetLaunchLineAction,
  SetLaunchPermissionAction,
  SetLiveTargetAction,
  SetLiveVersionAction,
  SetProductDriveAction,
  StartLaunchAction,
} from "./actions.js";

export const setLiveTarget = (input: SetLiveTargetInput) =>
  createAction<SetLiveTargetAction>(
    "SET_LIVE_TARGET",
    { ...input },
    undefined,
    SetLiveTargetInputSchema,
    "global",
  );

export const setProductDrive = (input: SetProductDriveInput) =>
  createAction<SetProductDriveAction>(
    "SET_PRODUCT_DRIVE",
    { ...input },
    undefined,
    SetProductDriveInputSchema,
    "global",
  );

export const requestLaunch = (input: RequestLaunchInput) =>
  createAction<RequestLaunchAction>(
    "REQUEST_LAUNCH",
    { ...input },
    undefined,
    RequestLaunchInputSchema,
    "global",
  );

export const requestRollback = (input: RequestRollbackInput) =>
  createAction<RequestRollbackAction>(
    "REQUEST_ROLLBACK",
    { ...input },
    undefined,
    RequestRollbackInputSchema,
    "global",
  );

export const requestDiscard = (input: RequestDiscardInput) =>
  createAction<RequestDiscardAction>(
    "REQUEST_DISCARD",
    { ...input },
    undefined,
    RequestDiscardInputSchema,
    "global",
  );

export const requestRestart = (input: RequestRestartInput) =>
  createAction<RequestRestartAction>(
    "REQUEST_RESTART",
    { ...input },
    undefined,
    RequestRestartInputSchema,
    "global",
  );

export const requestMirror = (input: RequestMirrorInput) =>
  createAction<RequestMirrorAction>(
    "REQUEST_MIRROR",
    { ...input },
    undefined,
    RequestMirrorInputSchema,
    "global",
  );

export const clearRequest = (input: ClearRequestInput) =>
  createAction<ClearRequestAction>(
    "CLEAR_REQUEST",
    { ...input },
    undefined,
    ClearRequestInputSchema,
    "global",
  );

export const startLaunch = (input: StartLaunchInput) =>
  createAction<StartLaunchAction>(
    "START_LAUNCH",
    { ...input },
    undefined,
    StartLaunchInputSchema,
    "global",
  );

export const setLaunchLine = (input: SetLaunchLineInput) =>
  createAction<SetLaunchLineAction>(
    "SET_LAUNCH_LINE",
    { ...input },
    undefined,
    SetLaunchLineInputSchema,
    "global",
  );

export const completeLaunch = (input: CompleteLaunchInput) =>
  createAction<CompleteLaunchAction>(
    "COMPLETE_LAUNCH",
    { ...input },
    undefined,
    CompleteLaunchInputSchema,
    "global",
  );

export const failLaunch = (input: FailLaunchInput) =>
  createAction<FailLaunchAction>(
    "FAIL_LAUNCH",
    { ...input },
    undefined,
    FailLaunchInputSchema,
    "global",
  );

export const setLiveVersion = (input: SetLiveVersionInput) =>
  createAction<SetLiveVersionAction>(
    "SET_LIVE_VERSION",
    { ...input },
    undefined,
    SetLiveVersionInputSchema,
    "global",
  );

export const setHealth = (input: SetHealthInput) =>
  createAction<SetHealthAction>(
    "SET_HEALTH",
    { ...input },
    undefined,
    SetHealthInputSchema,
    "global",
  );

export const setLaunchPermission = (input: SetLaunchPermissionInput) =>
  createAction<SetLaunchPermissionAction>(
    "SET_LAUNCH_PERMISSION",
    { ...input },
    undefined,
    SetLaunchPermissionInputSchema,
    "global",
  );
