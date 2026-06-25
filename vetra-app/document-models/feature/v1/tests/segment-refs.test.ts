import { generateMock } from "document-model";
import {
  addSegmentRef,
  AddSegmentRefInputSchema,
  isFeatureDocument,
  reducer,
  removeSegmentRef,
  RemoveSegmentRefInputSchema,
  reorderSegmentRefs,
  ReorderSegmentRefsInputSchema,
  updateSegmentRefSnippet,
  UpdateSegmentRefSnippetInputSchema,
  utils,
} from "document-models/feature/v1";
import { describe, expect, it } from "vitest";

describe("SegmentRefsOperations", () => {
  it("should handle addSegmentRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddSegmentRefInputSchema());

    const updatedDocument = reducer(document, addSegmentRef(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_SEGMENT_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateSegmentRefSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateSegmentRefSnippetInputSchema());

    const updatedDocument = reducer(document, updateSegmentRefSnippet(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_SEGMENT_REF_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeSegmentRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveSegmentRefInputSchema());

    const updatedDocument = reducer(document, removeSegmentRef(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_SEGMENT_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderSegmentRefs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderSegmentRefsInputSchema());

    const updatedDocument = reducer(document, reorderSegmentRefs(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_SEGMENT_REFS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
