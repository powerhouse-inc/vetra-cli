/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating StudioProductDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  StudioProductDocument,
  StudioProductGlobalState,
  StudioProductLocalState,
  StudioProductPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): StudioProductGlobalState {
  return {
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
    origins: [],
    notes: {
      enabled: false,
      since: null,
    },
    publicSource: null,
    sourceNoticeAcceptedAt: null,
    understood: null,
    explainersSeen: [],
    guidedLoop: {
      status: "NOT_STARTED",
      at: null,
    },
    rowImports: [],
  };
}

export function defaultLocalState(): StudioProductLocalState {
  return {};
}

export function defaultPHState(): StudioProductPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<StudioProductGlobalState>,
): StudioProductGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<StudioProductLocalState>,
): StudioProductLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as StudioProductLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<StudioProductGlobalState>,
  localState?: Partial<StudioProductLocalState>,
): StudioProductPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a StudioProductDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createStudioProductDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<StudioProductGlobalState>;
    local?: Partial<StudioProductLocalState>;
  }>,
): StudioProductDocument {
  const document = utils.createDocument(
    createState(
      createBaseState(state?.auth, { version: 1, ...state?.document }),
      state?.global,
      state?.local,
    ),
  );

  return document;
}
