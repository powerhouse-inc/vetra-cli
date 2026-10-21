/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AnswerQuestionInput,
  AskQuestionInput,
  FinishRowImportInput,
  MarkExplainersSeenInput,
  SetChangeCostInput,
  SetGuidedLoopInput,
  SetUnderstoodInput,
  StartRowImportInput,
} from "../types.js";

export type SetUnderstoodAction = Action & {
  type: "SET_UNDERSTOOD";
  input: SetUnderstoodInput;
};
export type MarkExplainersSeenAction = Action & {
  type: "MARK_EXPLAINERS_SEEN";
  input: MarkExplainersSeenInput;
};
export type SetGuidedLoopAction = Action & {
  type: "SET_GUIDED_LOOP";
  input: SetGuidedLoopInput;
};
export type AskQuestionAction = Action & {
  type: "ASK_QUESTION";
  input: AskQuestionInput;
};
export type AnswerQuestionAction = Action & {
  type: "ANSWER_QUESTION";
  input: AnswerQuestionInput;
};
export type SetChangeCostAction = Action & {
  type: "SET_CHANGE_COST";
  input: SetChangeCostInput;
};
export type StartRowImportAction = Action & {
  type: "START_ROW_IMPORT";
  input: StartRowImportInput;
};
export type FinishRowImportAction = Action & {
  type: "FINISH_ROW_IMPORT";
  input: FinishRowImportInput;
};

export type StudioProductWorkshopAction =
  | SetUnderstoodAction
  | MarkExplainersSeenAction
  | SetGuidedLoopAction
  | AskQuestionAction
  | AnswerQuestionAction
  | SetChangeCostAction
  | StartRowImportAction
  | FinishRowImportAction;
