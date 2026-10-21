/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { StudioProductGlobalState } from "../types.js";
import type {
  AnswerQuestionAction,
  AskQuestionAction,
  FinishRowImportAction,
  MarkExplainersSeenAction,
  SetChangeCostAction,
  SetGuidedLoopAction,
  SetUnderstoodAction,
  StartRowImportAction,
} from "./actions.js";

export interface StudioProductWorkshopOperations {
  setUnderstoodOperation: (
    state: StudioProductGlobalState,
    action: SetUnderstoodAction,
    dispatch?: SignalDispatch,
  ) => void;
  markExplainersSeenOperation: (
    state: StudioProductGlobalState,
    action: MarkExplainersSeenAction,
    dispatch?: SignalDispatch,
  ) => void;
  setGuidedLoopOperation: (
    state: StudioProductGlobalState,
    action: SetGuidedLoopAction,
    dispatch?: SignalDispatch,
  ) => void;
  askQuestionOperation: (
    state: StudioProductGlobalState,
    action: AskQuestionAction,
    dispatch?: SignalDispatch,
  ) => void;
  answerQuestionOperation: (
    state: StudioProductGlobalState,
    action: AnswerQuestionAction,
    dispatch?: SignalDispatch,
  ) => void;
  setChangeCostOperation: (
    state: StudioProductGlobalState,
    action: SetChangeCostAction,
    dispatch?: SignalDispatch,
  ) => void;
  startRowImportOperation: (
    state: StudioProductGlobalState,
    action: StartRowImportAction,
    dispatch?: SignalDispatch,
  ) => void;
  finishRowImportOperation: (
    state: StudioProductGlobalState,
    action: FinishRowImportAction,
    dispatch?: SignalDispatch,
  ) => void;
}
