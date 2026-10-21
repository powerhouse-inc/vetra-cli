/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentModelModule } from "document-model";
import { createState, defaultBaseState } from "document-model";
import { actions } from "./actions.js";
import { documentModel } from "./gen/document-model.js";
import { reducer } from "./gen/reducer.js";
import type { StudioTeamPHState } from "./gen/types.js";
import { utils } from "./utils.js";

/** Document model module for the StudioTeam document type */
export const StudioTeam = {
  version: 1,
  reducer,
  actions,
  utils,
  documentModel: createState(defaultBaseState(), documentModel),
} as const satisfies DocumentModelModule<StudioTeamPHState>;
