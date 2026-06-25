import { generateMock } from "document-model";
import {
  addTypeface,
  AddTypefaceInputSchema,
  isBrandSheetDocument,
  reducer,
  removeTypeface,
  RemoveTypefaceInputSchema,
  reorderTypefaces,
  ReorderTypefacesInputSchema,
  updateTypeface,
  UpdateTypefaceInputSchema,
  utils,
} from "document-models/brand-sheet/v1";
import { describe, expect, it } from "vitest";

describe("TypographyOperations", () => {
  it("should handle addTypeface operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTypefaceInputSchema());

    const updatedDocument = reducer(document, addTypeface(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_TYPEFACE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTypeface operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTypefaceInputSchema());

    const updatedDocument = reducer(document, updateTypeface(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TYPEFACE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTypeface operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTypefaceInputSchema());

    const updatedDocument = reducer(document, removeTypeface(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TYPEFACE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderTypefaces operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderTypefacesInputSchema());

    const updatedDocument = reducer(document, reorderTypefaces(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_TYPEFACES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
