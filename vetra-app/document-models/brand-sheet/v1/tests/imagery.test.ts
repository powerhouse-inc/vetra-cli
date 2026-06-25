import { generateMock } from "document-model";
import {
  addImageryReference,
  AddImageryReferenceInputSchema,
  clearImageryDirection,
  ClearImageryDirectionInputSchema,
  isBrandSheetDocument,
  reducer,
  removeImageryReference,
  RemoveImageryReferenceInputSchema,
  reorderImageryReferences,
  ReorderImageryReferencesInputSchema,
  setImageryDirection,
  SetImageryDirectionInputSchema,
  setImageryGuidance,
  SetImageryGuidanceInputSchema,
  utils,
} from "document-models/brand-sheet/v1";
import { describe, expect, it } from "vitest";

describe("ImageryOperations", () => {
  it("should handle setImageryDirection operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetImageryDirectionInputSchema());

    const updatedDocument = reducer(document, setImageryDirection(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_IMAGERY_DIRECTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearImageryDirection operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearImageryDirectionInputSchema());

    const updatedDocument = reducer(document, clearImageryDirection(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_IMAGERY_DIRECTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setImageryGuidance operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetImageryGuidanceInputSchema());

    const updatedDocument = reducer(document, setImageryGuidance(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_IMAGERY_GUIDANCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addImageryReference operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddImageryReferenceInputSchema(), {
      url: "https://example.com",
    });

    const updatedDocument = reducer(document, addImageryReference(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_IMAGERY_REFERENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeImageryReference operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveImageryReferenceInputSchema());

    const updatedDocument = reducer(document, removeImageryReference(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_IMAGERY_REFERENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderImageryReferences operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderImageryReferencesInputSchema());

    const updatedDocument = reducer(document, reorderImageryReferences(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_IMAGERY_REFERENCES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
