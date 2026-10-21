/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { StudioTeamGuestsAction } from "./guests/actions.js";
import type { StudioTeamLimitsAction } from "./limits/actions.js";
import type { StudioTeamTeamAction } from "./team/actions.js";

export * from "./guests/actions.js";
export * from "./limits/actions.js";
export * from "./team/actions.js";

export type StudioTeamAction =
  StudioTeamTeamAction | StudioTeamGuestsAction | StudioTeamLimitsAction;
