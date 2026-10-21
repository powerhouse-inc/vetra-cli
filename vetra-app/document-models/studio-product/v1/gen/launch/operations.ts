/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioProductGlobalState } from "../types.js";
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

export interface StudioProductLaunchOperations {
  setLiveTargetOperation: (
    state: StudioProductGlobalState,
    action: SetLiveTargetAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProductDriveOperation: (
    state: StudioProductGlobalState,
    action: SetProductDriveAction,
    dispatch?: SignalDispatch,
  ) => void;
  requestLaunchOperation: (
    state: StudioProductGlobalState,
    action: RequestLaunchAction,
    dispatch?: SignalDispatch,
  ) => void;
  requestRollbackOperation: (
    state: StudioProductGlobalState,
    action: RequestRollbackAction,
    dispatch?: SignalDispatch,
  ) => void;
  requestDiscardOperation: (
    state: StudioProductGlobalState,
    action: RequestDiscardAction,
    dispatch?: SignalDispatch,
  ) => void;
  requestRestartOperation: (
    state: StudioProductGlobalState,
    action: RequestRestartAction,
    dispatch?: SignalDispatch,
  ) => void;
  requestMirrorOperation: (
    state: StudioProductGlobalState,
    action: RequestMirrorAction,
    dispatch?: SignalDispatch,
  ) => void;
  clearRequestOperation: (
    state: StudioProductGlobalState,
    action: ClearRequestAction,
    dispatch?: SignalDispatch,
  ) => void;
  startLaunchOperation: (
    state: StudioProductGlobalState,
    action: StartLaunchAction,
    dispatch?: SignalDispatch,
  ) => void;
  setLaunchLineOperation: (
    state: StudioProductGlobalState,
    action: SetLaunchLineAction,
    dispatch?: SignalDispatch,
  ) => void;
  completeLaunchOperation: (
    state: StudioProductGlobalState,
    action: CompleteLaunchAction,
    dispatch?: SignalDispatch,
  ) => void;
  failLaunchOperation: (
    state: StudioProductGlobalState,
    action: FailLaunchAction,
    dispatch?: SignalDispatch,
  ) => void;
  setLiveVersionOperation: (
    state: StudioProductGlobalState,
    action: SetLiveVersionAction,
    dispatch?: SignalDispatch,
  ) => void;
  setHealthOperation: (
    state: StudioProductGlobalState,
    action: SetHealthAction,
    dispatch?: SignalDispatch,
  ) => void;
  setLaunchPermissionOperation: (
    state: StudioProductGlobalState,
    action: SetLaunchPermissionAction,
    dispatch?: SignalDispatch,
  ) => void;
}
