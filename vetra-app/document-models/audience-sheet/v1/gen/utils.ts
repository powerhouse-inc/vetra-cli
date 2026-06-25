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
import { audienceSheetUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsAudienceSheetDocument,
  assertIsAudienceSheetState,
  isAudienceSheetDocument,
  isAudienceSheetState,
} from "./document-schema.js";
import { audienceSheetDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  AudienceSheetGlobalState,
  AudienceSheetLocalState,
  AudienceSheetPHState,
} from "./types.js";

export const initialGlobalState: AudienceSheetGlobalState = {
  segments: [],
  agentFeedback: {
    readyForFeedback: false,
    suggestions: [],
  },
};
export const initialLocalState: AudienceSheetLocalState = {};

export const utils: DocumentModelUtils<AudienceSheetPHState> = {
  fileExtension: "aus",
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
      audienceSheetDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: audienceSheetUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isAudienceSheetState(state);
  },
  assertIsStateOfType(state) {
    return assertIsAudienceSheetState(state);
  },
  isDocumentOfType(document) {
    return isAudienceSheetDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsAudienceSheetDocument(document);
  },
};
