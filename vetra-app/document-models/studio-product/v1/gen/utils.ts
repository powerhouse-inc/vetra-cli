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
import { studioProductUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsStudioProductDocument,
  assertIsStudioProductState,
  isStudioProductDocument,
  isStudioProductState,
} from "./document-schema.js";
import { studioProductDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  StudioProductGlobalState,
  StudioProductLocalState,
  StudioProductPHState,
} from "./types.js";

export const initialGlobalState: StudioProductGlobalState = {
  name: null,
  idea: null,
  slug: null,
  liveUrl: null,
  appId: null,
  productionEnvironmentId: null,
  productDriveId: null,
  createdAt: null,
  access: "SIGNED_IN",
  changes: [],
  activeChangeId: null,
  liveVersion: null,
  liveSince: null,
  liveDeploymentId: null,
  versions: [],
  health: "UNKNOWN",
  pendingRequest: null,
  lastRequestFailure: null,
  launchPermission: "UNKNOWN",
  suggestions: [],
  github: {
    status: "NOT_CONNECTED",
    repoFullName: null,
    lastError: null,
    externalChangesSha: null,
  },
  liveBeforeVersions: null,
};
export const initialLocalState: StudioProductLocalState = {};

export const utils: DocumentModelUtils<StudioProductPHState> = {
  fileExtension: "vsp",
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
      studioProductDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: studioProductUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isStudioProductState(state);
  },
  assertIsStateOfType(state) {
    return assertIsStudioProductState(state);
  },
  isDocumentOfType(document) {
    return isStudioProductDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsStudioProductDocument(document);
  },
};
