/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AnswerQuestionInputSchema,
  AskQuestionInputSchema,
  FinishRowImportInputSchema,
  MarkExplainersSeenInputSchema,
  SetChangeCostInputSchema,
  SetGuidedLoopInputSchema,
  SetUnderstoodInputSchema,
  StartRowImportInputSchema,
} from "../schema/zod.js";
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

export const setUnderstood = (input: SetUnderstoodInput) =>
  createAction<SetUnderstoodAction>(
    "SET_UNDERSTOOD",
    { ...input },
    undefined,
    SetUnderstoodInputSchema,
    "global",
  );

export const markExplainersSeen = (input: MarkExplainersSeenInput) =>
  createAction<MarkExplainersSeenAction>(
    "MARK_EXPLAINERS_SEEN",
    { ...input },
    undefined,
    MarkExplainersSeenInputSchema,
    "global",
  );

export const setGuidedLoop = (input: SetGuidedLoopInput) =>
  createAction<SetGuidedLoopAction>(
    "SET_GUIDED_LOOP",
    { ...input },
    undefined,
    SetGuidedLoopInputSchema,
    "global",
  );

export const askQuestion = (input: AskQuestionInput) =>
  createAction<AskQuestionAction>(
    "ASK_QUESTION",
    { ...input },
    undefined,
    AskQuestionInputSchema,
    "global",
  );

export const answerQuestion = (input: AnswerQuestionInput) =>
  createAction<AnswerQuestionAction>(
    "ANSWER_QUESTION",
    { ...input },
    undefined,
    AnswerQuestionInputSchema,
    "global",
  );

export const setChangeCost = (input: SetChangeCostInput) =>
  createAction<SetChangeCostAction>(
    "SET_CHANGE_COST",
    { ...input },
    undefined,
    SetChangeCostInputSchema,
    "global",
  );

export const startRowImport = (input: StartRowImportInput) =>
  createAction<StartRowImportAction>(
    "START_ROW_IMPORT",
    { ...input },
    undefined,
    StartRowImportInputSchema,
    "global",
  );

export const finishRowImport = (input: FinishRowImportInput) =>
  createAction<FinishRowImportAction>(
    "FINISH_ROW_IMPORT",
    { ...input },
    undefined,
    FinishRowImportInputSchema,
    "global",
  );
