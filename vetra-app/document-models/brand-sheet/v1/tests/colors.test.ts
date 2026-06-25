import { generateMock } from "document-model";
import {
  addColor,
  AddColorInputSchema,
  isBrandSheetDocument,
  reducer,
  removeColor,
  RemoveColorInputSchema,
  reorderColors,
  ReorderColorsInputSchema,
  updateColor,
  UpdateColorInputSchema,
  utils,
} from "document-models/brand-sheet/v1";
import { describe, expect, it } from "vitest";

describe("ColorsOperations", () => {
  it("should handle addColor operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddColorInputSchema());

    const updatedDocument = reducer(document, addColor(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_COLOR");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateColor operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateColorInputSchema());

    const updatedDocument = reducer(document, updateColor(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_COLOR",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeColor operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveColorInputSchema());

    const updatedDocument = reducer(document, removeColor(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_COLOR",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderColors operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderColorsInputSchema());

    const updatedDocument = reducer(document, reorderColors(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_COLORS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
