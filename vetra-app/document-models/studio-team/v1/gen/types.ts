/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { StudioTeamAction } from "./actions.js";
import type { StudioTeamState as StudioTeamGlobalState } from "./schema/types.js";

type StudioTeamLocalState = Record<PropertyKey, never>;

type StudioTeamPHState = PHBaseState & {
  global: StudioTeamGlobalState;
  local: StudioTeamLocalState;
};
type StudioTeamDocument = PHDocument<StudioTeamPHState>;

export * from "./schema/types.js";

export type {
  StudioTeamAction,
  StudioTeamDocument,
  StudioTeamGlobalState,
  StudioTeamLocalState,
  StudioTeamPHState,
};
