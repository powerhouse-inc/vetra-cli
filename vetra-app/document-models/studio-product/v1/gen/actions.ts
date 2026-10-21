/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { StudioProductChangeAction } from "./change/actions.js";
import type { StudioProductLaunchAction } from "./launch/actions.js";
import type { StudioProductProductAction } from "./product/actions.js";
import type { StudioProductSuggestionsAction } from "./suggestions/actions.js";

export * from "./change/actions.js";
export * from "./launch/actions.js";
export * from "./product/actions.js";
export * from "./suggestions/actions.js";

export type StudioProductAction =
  | StudioProductProductAction
  | StudioProductChangeAction
  | StudioProductLaunchAction
  | StudioProductSuggestionsAction;
