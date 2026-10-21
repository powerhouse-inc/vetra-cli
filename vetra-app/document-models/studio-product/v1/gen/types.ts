/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { StudioProductAction } from "./actions.js";
import type { StudioProductState as StudioProductGlobalState } from "./schema/types.js";

type StudioProductLocalState = Record<PropertyKey, never>;

type StudioProductPHState = PHBaseState & {
  global: StudioProductGlobalState;
  local: StudioProductLocalState;
};
type StudioProductDocument = PHDocument<StudioProductPHState>;

export * from "./schema/types.js";

export type {
  StudioProductAction,
  StudioProductDocument,
  StudioProductGlobalState,
  StudioProductLocalState,
  StudioProductPHState,
};
