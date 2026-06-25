import { generateMock } from "document-model";
import {
  clearConcept,
  ClearConceptInputSchema,
  clearMaxim,
  ClearMaximInputSchema,
  clearProductName,
  ClearProductNameInputSchema,
  isBrandSheetDocument,
  reducer,
  setConcept,
  SetConceptInputSchema,
  setMaxim,
  SetMaximInputSchema,
  setProductName,
  SetProductNameInputSchema,
  utils,
} from "document-models/brand-sheet/v1";
import { describe, expect, it } from "vitest";

describe("IdentityOperations", () => {
  it("should handle setProductName operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetProductNameInputSchema());

    const updatedDocument = reducer(document, setProductName(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PRODUCT_NAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearProductName operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearProductNameInputSchema());

    const updatedDocument = reducer(document, clearProductName(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_PRODUCT_NAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMaxim operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMaximInputSchema());

    const updatedDocument = reducer(document, setMaxim(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_MAXIM");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearMaxim operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearMaximInputSchema());

    const updatedDocument = reducer(document, clearMaxim(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_MAXIM",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setConcept operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetConceptInputSchema());

    const updatedDocument = reducer(document, setConcept(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_CONCEPT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearConcept operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearConceptInputSchema());

    const updatedDocument = reducer(document, clearConcept(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_CONCEPT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
