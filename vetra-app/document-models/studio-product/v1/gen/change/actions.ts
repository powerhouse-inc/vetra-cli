/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddMilestoneInput,
  AdoptExistingInput,
  ClearStuckInput,
  CompleteStepInput,
  CountStepInput,
  DiscardChangeInput,
  MarkStuckInput,
  PauseChangeInput,
  PlanStepsInput,
  RecordChangeMetricsInput,
  RecordCheckRunInput,
  ReopenStepInput,
  ResumeChangeInput,
  SetChangeTitleInput,
  SetLiveBeforeVersionsInput,
  SetStepAttentionInput,
  StartChangeInput,
  StartStepInput,
  WaiveLintInput,
} from "../types.js";

export type StartChangeAction = Action & {
  type: "START_CHANGE";
  input: StartChangeInput;
};
export type AdoptExistingAction = Action & {
  type: "ADOPT_EXISTING";
  input: AdoptExistingInput;
};
export type SetLiveBeforeVersionsAction = Action & {
  type: "SET_LIVE_BEFORE_VERSIONS";
  input: SetLiveBeforeVersionsInput;
};
export type PlanStepsAction = Action & {
  type: "PLAN_STEPS";
  input: PlanStepsInput;
};
export type StartStepAction = Action & {
  type: "START_STEP";
  input: StartStepInput;
};
export type CountStepAction = Action & {
  type: "COUNT_STEP";
  input: CountStepInput;
};
export type CompleteStepAction = Action & {
  type: "COMPLETE_STEP";
  input: CompleteStepInput;
};
export type ReopenStepAction = Action & {
  type: "REOPEN_STEP";
  input: ReopenStepInput;
};
export type AddMilestoneAction = Action & {
  type: "ADD_MILESTONE";
  input: AddMilestoneInput;
};
export type RecordCheckRunAction = Action & {
  type: "RECORD_CHECK_RUN";
  input: RecordCheckRunInput;
};
export type MarkStuckAction = Action & {
  type: "MARK_STUCK";
  input: MarkStuckInput;
};
export type ClearStuckAction = Action & {
  type: "CLEAR_STUCK";
  input: ClearStuckInput;
};
export type SetStepAttentionAction = Action & {
  type: "SET_STEP_ATTENTION";
  input: SetStepAttentionInput;
};
export type PauseChangeAction = Action & {
  type: "PAUSE_CHANGE";
  input: PauseChangeInput;
};
export type ResumeChangeAction = Action & {
  type: "RESUME_CHANGE";
  input: ResumeChangeInput;
};
export type RecordChangeMetricsAction = Action & {
  type: "RECORD_CHANGE_METRICS";
  input: RecordChangeMetricsInput;
};
export type SetChangeTitleAction = Action & {
  type: "SET_CHANGE_TITLE";
  input: SetChangeTitleInput;
};
export type WaiveLintAction = Action & {
  type: "WAIVE_LINT";
  input: WaiveLintInput;
};
export type DiscardChangeAction = Action & {
  type: "DISCARD_CHANGE";
  input: DiscardChangeInput;
};

export type StudioProductChangeAction =
  | StartChangeAction
  | AdoptExistingAction
  | SetLiveBeforeVersionsAction
  | PlanStepsAction
  | StartStepAction
  | CountStepAction
  | CompleteStepAction
  | ReopenStepAction
  | AddMilestoneAction
  | RecordCheckRunAction
  | MarkStuckAction
  | ClearStuckAction
  | SetStepAttentionAction
  | PauseChangeAction
  | ResumeChangeAction
  | RecordChangeMetricsAction
  | SetChangeTitleAction
  | WaiveLintAction
  | DiscardChangeAction;
