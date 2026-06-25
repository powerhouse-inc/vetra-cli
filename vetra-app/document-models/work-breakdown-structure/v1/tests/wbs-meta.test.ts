import { generateMock } from "document-model";
import {
  clearFeature,
  ClearFeatureInputSchema,
  clearWbsDescription,
  ClearWbsDescriptionInputSchema,
  clearWbsName,
  ClearWbsNameInputSchema,
  isWorkBreakdownStructureDocument,
  reducer,
  setFeature,
  SetFeatureInputSchema,
  setWbsDescription,
  SetWbsDescriptionInputSchema,
  setWbsName,
  SetWbsNameInputSchema,
  updateFeatureSnippet,
  UpdateFeatureSnippetInputSchema,
  utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

describe("WbsMetaOperations", () => {
  it("should handle setWbsName operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetWbsNameInputSchema());

    const updatedDocument = reducer(document, setWbsName(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_WBS_NAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearWbsName operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearWbsNameInputSchema());

    const updatedDocument = reducer(document, clearWbsName(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_WBS_NAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setWbsDescription operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetWbsDescriptionInputSchema());

    const updatedDocument = reducer(document, setWbsDescription(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_WBS_DESCRIPTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearWbsDescription operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearWbsDescriptionInputSchema());

    const updatedDocument = reducer(document, clearWbsDescription(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_WBS_DESCRIPTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetFeatureInputSchema());

    const updatedDocument = reducer(document, setFeature(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateFeatureSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateFeatureSnippetInputSchema());

    const updatedDocument = reducer(document, updateFeatureSnippet(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_FEATURE_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearFeatureInputSchema());

    const updatedDocument = reducer(document, clearFeature(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
