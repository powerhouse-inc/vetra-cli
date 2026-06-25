/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentModelUtils, PHBaseState, Reducer } from "document-model";
import {
  baseCreateDocument,
  baseLoadFromInputVersioned,
  baseSaveToFileHandle,
  createBaseState,
} from "document-model";
import { problemSheetUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsProblemSheetDocument,
  assertIsProblemSheetState,
  isProblemSheetDocument,
  isProblemSheetState,
} from "./document-schema.js";
import { problemSheetDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  ProblemSheetGlobalState,
  ProblemSheetLocalState,
  ProblemSheetPHState,
} from "./types.js";

export const initialGlobalState: ProblemSheetGlobalState = {
  context: null,
  coreJob: null,
  coreJobSteps: [],
  roles: [],
  outcomes: [],
  constraints: [],
  agentFeedback: {
    readyForFeedback: false,
    suggestions: [],
  },
};
export const initialLocalState: ProblemSheetLocalState = {};

export const utils: DocumentModelUtils<ProblemSheetPHState> = {
  fileExtension: "prs",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(
      utils.createState,
      state,
      problemSheetDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: problemSheetUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isProblemSheetState(state);
  },
  assertIsStateOfType(state) {
    return assertIsProblemSheetState(state);
  },
  isDocumentOfType(document) {
    return isProblemSheetDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsProblemSheetDocument(document);
  },
};
