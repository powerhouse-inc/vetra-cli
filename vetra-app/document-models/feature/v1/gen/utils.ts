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
import { featureUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsFeatureDocument,
  assertIsFeatureState,
  isFeatureDocument,
  isFeatureState,
} from "./document-schema.js";
import { featureDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  FeatureGlobalState,
  FeatureLocalState,
  FeaturePHState,
} from "./types.js";

export const initialGlobalState: FeatureGlobalState = {
  name: null,
  summary: null,
  scope: "MICRO_MVP",
  premise: null,
  expectedEffect: null,
  reasoning: null,
  targets: [],
  segments: [],
  role: null,
  relatedStep: null,
  confidence: null,
  effort: null,
  impact: null,
  targetRelease: null,
  evidence: [],
  notes: null,
  status: "PROPOSED",
  promotion: null,
  parentFeature: null,
  wbs: null,
  agentFeedback: {
    readyForFeedback: false,
    suggestions: [],
  },
};
export const initialLocalState: FeatureLocalState = {};

export const utils: DocumentModelUtils<FeaturePHState> = {
  fileExtension: "ftr",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, featureDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: featureUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isFeatureState(state);
  },
  assertIsStateOfType(state) {
    return assertIsFeatureState(state);
  },
  isDocumentOfType(document) {
    return isFeatureDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsFeatureDocument(document);
  },
};
