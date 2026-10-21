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
import { studioTeamUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsStudioTeamDocument,
  assertIsStudioTeamState,
  isStudioTeamDocument,
  isStudioTeamState,
} from "./document-schema.js";
import { studioTeamDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  StudioTeamGlobalState,
  StudioTeamLocalState,
  StudioTeamPHState,
} from "./types.js";

export const initialGlobalState: StudioTeamGlobalState = {
  orgId: null,
  reviewRequired: false,
  reviewers: [],
  roleOverrides: [],
  guests: [],
  memberLimits: [],
};
export const initialLocalState: StudioTeamLocalState = {};

export const utils: DocumentModelUtils<StudioTeamPHState> = {
  fileExtension: "vst",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, studioTeamDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: studioTeamUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isStudioTeamState(state);
  },
  assertIsStateOfType(state) {
    return assertIsStudioTeamState(state);
  },
  isDocumentOfType(document) {
    return isStudioTeamDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsStudioTeamDocument(document);
  },
};
