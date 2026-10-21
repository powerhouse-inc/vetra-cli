/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { baseActions } from "document-model";
import {
  studioTeamGuestsActions,
  studioTeamLimitsActions,
  studioTeamTeamActions,
} from "./gen/creators.js";

/** Actions for the StudioTeam document model */

export const actions = {
  ...baseActions,
  ...studioTeamTeamActions,
  ...studioTeamGuestsActions,
  ...studioTeamLimitsActions,
};
