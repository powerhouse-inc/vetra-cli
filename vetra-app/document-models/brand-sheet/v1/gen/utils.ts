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
import { brandSheetUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsBrandSheetDocument,
  assertIsBrandSheetState,
  isBrandSheetDocument,
  isBrandSheetState,
} from "./document-schema.js";
import { brandSheetDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  BrandSheetGlobalState,
  BrandSheetLocalState,
  BrandSheetPHState,
} from "./types.js";

export const initialGlobalState: BrandSheetGlobalState = {
  name: null,
  maxim: null,
  concept: null,
  logos: [],
  colors: [],
  typography: [],
  voice: null,
  imagery: null,
  agentFeedback: {
    readyForFeedback: false,
    suggestions: [],
  },
};
export const initialLocalState: BrandSheetLocalState = {};

export const utils: DocumentModelUtils<BrandSheetPHState> = {
  fileExtension: "brs",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, brandSheetDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: brandSheetUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isBrandSheetState(state);
  },
  assertIsStateOfType(state) {
    return assertIsBrandSheetState(state);
  },
  isDocumentOfType(document) {
    return isBrandSheetDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsBrandSheetDocument(document);
  },
};
