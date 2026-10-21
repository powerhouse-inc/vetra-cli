/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { studioTeamDocumentType } from "./document-type.js";
import { StudioTeamStateSchema } from "./schema/zod.js";
import type { StudioTeamDocument, StudioTeamPHState } from "./types.js";

/** Schema for validating the header object of a StudioTeam document */
export const StudioTeamDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(studioTeamDocumentType),
});

/** Schema for validating the state object of a StudioTeam document */
export const StudioTeamPHStateSchema = BaseDocumentStateSchema.extend({
  global: StudioTeamStateSchema(),
});

export const StudioTeamDocumentSchema = z.object({
  header: StudioTeamDocumentHeaderSchema,
  state: StudioTeamPHStateSchema,
  initialState: StudioTeamPHStateSchema,
});

/** Simple helper function to check if a state object is a StudioTeam document state object */
export function isStudioTeamState(state: unknown): state is StudioTeamPHState {
  return StudioTeamPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a StudioTeam document state object */
export function assertIsStudioTeamState(
  state: unknown,
): asserts state is StudioTeamPHState {
  StudioTeamPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a StudioTeam document */
export function isStudioTeamDocument(
  document: unknown,
): document is StudioTeamDocument {
  return StudioTeamDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a StudioTeam document */
export function assertIsStudioTeamDocument(
  document: unknown,
): asserts document is StudioTeamDocument {
  StudioTeamDocumentSchema.parse(document);
}
