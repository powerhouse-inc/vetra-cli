import { generateMock } from "document-model";
import {
  clearParentFeature,
  ClearParentFeatureInputSchema,
  clearRelatedStep,
  ClearRelatedStepInputSchema,
  clearRole,
  ClearRoleInputSchema,
  clearWbs,
  ClearWbsInputSchema,
  isFeatureDocument,
  reducer,
  setParentFeature,
  SetParentFeatureInputSchema,
  setRelatedStep,
  SetRelatedStepInputSchema,
  setRole,
  SetRoleInputSchema,
  setWbs,
  SetWbsInputSchema,
  updateParentFeatureSnippet,
  UpdateParentFeatureSnippetInputSchema,
  updateRelatedStepSnippet,
  UpdateRelatedStepSnippetInputSchema,
  updateRoleSnippet,
  UpdateRoleSnippetInputSchema,
  updateWbsSnippet,
  UpdateWbsSnippetInputSchema,
  utils,
} from "document-models/feature/v1";
import { describe, expect, it } from "vitest";

describe("ReferencesOperations", () => {
  it("should handle setRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetRoleInputSchema());

    const updatedDocument = reducer(document, setRole(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_ROLE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateRoleSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateRoleSnippetInputSchema());

    const updatedDocument = reducer(document, updateRoleSnippet(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_ROLE_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearRoleInputSchema());

    const updatedDocument = reducer(document, clearRole(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("CLEAR_ROLE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setRelatedStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetRelatedStepInputSchema());

    const updatedDocument = reducer(document, setRelatedStep(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_RELATED_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateRelatedStepSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateRelatedStepSnippetInputSchema());

    const updatedDocument = reducer(document, updateRelatedStepSnippet(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_RELATED_STEP_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearRelatedStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearRelatedStepInputSchema());

    const updatedDocument = reducer(document, clearRelatedStep(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_RELATED_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setParentFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetParentFeatureInputSchema());

    const updatedDocument = reducer(document, setParentFeature(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_PARENT_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateParentFeatureSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateParentFeatureSnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateParentFeatureSnippet(input),
    );

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_PARENT_FEATURE_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearParentFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearParentFeatureInputSchema());

    const updatedDocument = reducer(document, clearParentFeature(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_PARENT_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetWbsInputSchema());

    const updatedDocument = reducer(document, setWbs(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("SET_WBS");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateWbsSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateWbsSnippetInputSchema());

    const updatedDocument = reducer(document, updateWbsSnippet(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_WBS_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearWbsInputSchema());

    const updatedDocument = reducer(document, clearWbs(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("CLEAR_WBS");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
