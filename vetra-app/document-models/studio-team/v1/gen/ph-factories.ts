/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating StudioTeamDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  StudioTeamDocument,
  StudioTeamGlobalState,
  StudioTeamLocalState,
  StudioTeamPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): StudioTeamGlobalState {
  return {
    initialized: false,
    orgId: null,
    reviewRequired: false,
    reviewers: [],
    roleOverrides: [],
    guests: [],
    memberLimits: [],
  };
}

export function defaultLocalState(): StudioTeamLocalState {
  return {};
}

export function defaultPHState(): StudioTeamPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<StudioTeamGlobalState>,
): StudioTeamGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<StudioTeamLocalState>,
): StudioTeamLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as StudioTeamLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<StudioTeamGlobalState>,
  localState?: Partial<StudioTeamLocalState>,
): StudioTeamPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a StudioTeamDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createStudioTeamDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<StudioTeamGlobalState>;
    local?: Partial<StudioTeamLocalState>;
  }>,
): StudioTeamDocument {
  const document = utils.createDocument(
    createState(
      createBaseState(state?.auth, { version: 1, ...state?.document }),
      state?.global,
      state?.local,
    ),
  );

  return document;
}
