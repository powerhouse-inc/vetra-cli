/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { studioProductDocumentType } from "./document-type.js";
import { StudioProductStateSchema } from "./schema/zod.js";
import type { StudioProductDocument, StudioProductPHState } from "./types.js";

/** Schema for validating the header object of a StudioProduct document */
export const StudioProductDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(studioProductDocumentType),
  });

/** Schema for validating the state object of a StudioProduct document */
export const StudioProductPHStateSchema = BaseDocumentStateSchema.extend({
  global: StudioProductStateSchema(),
});

export const StudioProductDocumentSchema = z.object({
  header: StudioProductDocumentHeaderSchema,
  state: StudioProductPHStateSchema,
  initialState: StudioProductPHStateSchema,
});

/** Simple helper function to check if a state object is a StudioProduct document state object */
export function isStudioProductState(
  state: unknown,
): state is StudioProductPHState {
  return StudioProductPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a StudioProduct document state object */
export function assertIsStudioProductState(
  state: unknown,
): asserts state is StudioProductPHState {
  StudioProductPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a StudioProduct document */
export function isStudioProductDocument(
  document: unknown,
): document is StudioProductDocument {
  return StudioProductDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a StudioProduct document */
export function assertIsStudioProductDocument(
  document: unknown,
): asserts document is StudioProductDocument {
  StudioProductDocumentSchema.parse(document);
}
