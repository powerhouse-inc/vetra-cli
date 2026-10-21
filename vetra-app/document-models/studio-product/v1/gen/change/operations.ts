/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioProductGlobalState } from "../types.js";
import type {
  AddMilestoneAction,
  AdoptExistingAction,
  ClearStuckAction,
  CompleteStepAction,
  CountStepAction,
  DiscardChangeAction,
  MarkStuckAction,
  PauseChangeAction,
  PlanStepsAction,
  RecordChangeMetricsAction,
  RecordCheckRunAction,
  ReopenStepAction,
  ResumeChangeAction,
  SetChangeTitleAction,
  SetStepAttentionAction,
  StartChangeAction,
  StartStepAction,
  WaiveLintAction,
} from "./actions.js";

export interface StudioProductChangeOperations {
  startChangeOperation: (
    state: StudioProductGlobalState,
    action: StartChangeAction,
    dispatch?: SignalDispatch,
  ) => void;
  adoptExistingOperation: (
    state: StudioProductGlobalState,
    action: AdoptExistingAction,
    dispatch?: SignalDispatch,
  ) => void;
  planStepsOperation: (
    state: StudioProductGlobalState,
    action: PlanStepsAction,
    dispatch?: SignalDispatch,
  ) => void;
  startStepOperation: (
    state: StudioProductGlobalState,
    action: StartStepAction,
    dispatch?: SignalDispatch,
  ) => void;
  countStepOperation: (
    state: StudioProductGlobalState,
    action: CountStepAction,
    dispatch?: SignalDispatch,
  ) => void;
  completeStepOperation: (
    state: StudioProductGlobalState,
    action: CompleteStepAction,
    dispatch?: SignalDispatch,
  ) => void;
  reopenStepOperation: (
    state: StudioProductGlobalState,
    action: ReopenStepAction,
    dispatch?: SignalDispatch,
  ) => void;
  addMilestoneOperation: (
    state: StudioProductGlobalState,
    action: AddMilestoneAction,
    dispatch?: SignalDispatch,
  ) => void;
  recordCheckRunOperation: (
    state: StudioProductGlobalState,
    action: RecordCheckRunAction,
    dispatch?: SignalDispatch,
  ) => void;
  markStuckOperation: (
    state: StudioProductGlobalState,
    action: MarkStuckAction,
    dispatch?: SignalDispatch,
  ) => void;
  clearStuckOperation: (
    state: StudioProductGlobalState,
    action: ClearStuckAction,
    dispatch?: SignalDispatch,
  ) => void;
  setStepAttentionOperation: (
    state: StudioProductGlobalState,
    action: SetStepAttentionAction,
    dispatch?: SignalDispatch,
  ) => void;
  pauseChangeOperation: (
    state: StudioProductGlobalState,
    action: PauseChangeAction,
    dispatch?: SignalDispatch,
  ) => void;
  resumeChangeOperation: (
    state: StudioProductGlobalState,
    action: ResumeChangeAction,
    dispatch?: SignalDispatch,
  ) => void;
  recordChangeMetricsOperation: (
    state: StudioProductGlobalState,
    action: RecordChangeMetricsAction,
    dispatch?: SignalDispatch,
  ) => void;
  setChangeTitleOperation: (
    state: StudioProductGlobalState,
    action: SetChangeTitleAction,
    dispatch?: SignalDispatch,
  ) => void;
  waiveLintOperation: (
    state: StudioProductGlobalState,
    action: WaiveLintAction,
    dispatch?: SignalDispatch,
  ) => void;
  discardChangeOperation: (
    state: StudioProductGlobalState,
    action: DiscardChangeAction,
    dispatch?: SignalDispatch,
  ) => void;
}
