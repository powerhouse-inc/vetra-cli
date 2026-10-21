/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddMilestoneInputSchema,
  AdoptExistingInputSchema,
  ClearStuckInputSchema,
  CompleteStepInputSchema,
  CountStepInputSchema,
  DiscardChangeInputSchema,
  MarkStuckInputSchema,
  PauseChangeInputSchema,
  PlanStepsInputSchema,
  RecordChangeMetricsInputSchema,
  RecordCheckRunInputSchema,
  ReopenStepInputSchema,
  ResumeChangeInputSchema,
  SetChangeTitleInputSchema,
  SetStepAttentionInputSchema,
  StartChangeInputSchema,
  StartStepInputSchema,
  WaiveLintInputSchema,
} from "../schema/zod.js";
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
  SetStepAttentionInput,
  StartChangeInput,
  StartStepInput,
  WaiveLintInput,
} from "../types.js";
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

export const startChange = (input: StartChangeInput) =>
  createAction<StartChangeAction>(
    "START_CHANGE",
    { ...input },
    undefined,
    StartChangeInputSchema,
    "global",
  );

export const adoptExisting = (input: AdoptExistingInput) =>
  createAction<AdoptExistingAction>(
    "ADOPT_EXISTING",
    { ...input },
    undefined,
    AdoptExistingInputSchema,
    "global",
  );

export const planSteps = (input: PlanStepsInput) =>
  createAction<PlanStepsAction>(
    "PLAN_STEPS",
    { ...input },
    undefined,
    PlanStepsInputSchema,
    "global",
  );

export const startStep = (input: StartStepInput) =>
  createAction<StartStepAction>(
    "START_STEP",
    { ...input },
    undefined,
    StartStepInputSchema,
    "global",
  );

export const countStep = (input: CountStepInput) =>
  createAction<CountStepAction>(
    "COUNT_STEP",
    { ...input },
    undefined,
    CountStepInputSchema,
    "global",
  );

export const completeStep = (input: CompleteStepInput) =>
  createAction<CompleteStepAction>(
    "COMPLETE_STEP",
    { ...input },
    undefined,
    CompleteStepInputSchema,
    "global",
  );

export const reopenStep = (input: ReopenStepInput) =>
  createAction<ReopenStepAction>(
    "REOPEN_STEP",
    { ...input },
    undefined,
    ReopenStepInputSchema,
    "global",
  );

export const addMilestone = (input: AddMilestoneInput) =>
  createAction<AddMilestoneAction>(
    "ADD_MILESTONE",
    { ...input },
    undefined,
    AddMilestoneInputSchema,
    "global",
  );

export const recordCheckRun = (input: RecordCheckRunInput) =>
  createAction<RecordCheckRunAction>(
    "RECORD_CHECK_RUN",
    { ...input },
    undefined,
    RecordCheckRunInputSchema,
    "global",
  );

export const markStuck = (input: MarkStuckInput) =>
  createAction<MarkStuckAction>(
    "MARK_STUCK",
    { ...input },
    undefined,
    MarkStuckInputSchema,
    "global",
  );

export const clearStuck = (input: ClearStuckInput) =>
  createAction<ClearStuckAction>(
    "CLEAR_STUCK",
    { ...input },
    undefined,
    ClearStuckInputSchema,
    "global",
  );

export const setStepAttention = (input: SetStepAttentionInput) =>
  createAction<SetStepAttentionAction>(
    "SET_STEP_ATTENTION",
    { ...input },
    undefined,
    SetStepAttentionInputSchema,
    "global",
  );

export const pauseChange = (input: PauseChangeInput) =>
  createAction<PauseChangeAction>(
    "PAUSE_CHANGE",
    { ...input },
    undefined,
    PauseChangeInputSchema,
    "global",
  );

export const resumeChange = (input: ResumeChangeInput) =>
  createAction<ResumeChangeAction>(
    "RESUME_CHANGE",
    { ...input },
    undefined,
    ResumeChangeInputSchema,
    "global",
  );

export const recordChangeMetrics = (input: RecordChangeMetricsInput) =>
  createAction<RecordChangeMetricsAction>(
    "RECORD_CHANGE_METRICS",
    { ...input },
    undefined,
    RecordChangeMetricsInputSchema,
    "global",
  );

export const setChangeTitle = (input: SetChangeTitleInput) =>
  createAction<SetChangeTitleAction>(
    "SET_CHANGE_TITLE",
    { ...input },
    undefined,
    SetChangeTitleInputSchema,
    "global",
  );

export const waiveLint = (input: WaiveLintInput) =>
  createAction<WaiveLintAction>(
    "WAIVE_LINT",
    { ...input },
    undefined,
    WaiveLintInputSchema,
    "global",
  );

export const discardChange = (input: DiscardChangeInput) =>
  createAction<DiscardChangeAction>(
    "DISCARD_CHANGE",
    { ...input },
    undefined,
    DiscardChangeInputSchema,
    "global",
  );
