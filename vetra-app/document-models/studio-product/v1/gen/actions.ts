/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { StudioProductChangeAction } from "./change/actions.js";
import type { StudioProductProductAction } from "./product/actions.js";

export * from "./change/actions.js";
export * from "./product/actions.js";

export type StudioProductAction =
  StudioProductProductAction | StudioProductChangeAction;
