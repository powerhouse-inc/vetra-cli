import { generateMock } from "document-model";
import {
  addOutcomeTarget,
  AddOutcomeTargetInputSchema,
  isFeatureDocument,
  reducer,
  removeOutcomeTarget,
  RemoveOutcomeTargetInputSchema,
  reorderOutcomeTargets,
  ReorderOutcomeTargetsInputSchema,
  updateOutcomeTarget,
  UpdateOutcomeTargetInputSchema,
  updateOutcomeTargetSnippet,
  UpdateOutcomeTargetSnippetInputSchema,
  utils,
} from "document-models/feature/v1";
import { describe, expect, it } from "vitest";

describe("TargetsOperations", () => {
  it("should handle addOutcomeTarget operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddOutcomeTargetInputSchema());

    const updatedDocument = reducer(document, addOutcomeTarget(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_OUTCOME_TARGET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateOutcomeTarget operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateOutcomeTargetInputSchema());

    const updatedDocument = reducer(document, updateOutcomeTarget(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_OUTCOME_TARGET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateOutcomeTargetSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateOutcomeTargetSnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateOutcomeTargetSnippet(input),
    );

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_OUTCOME_TARGET_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeOutcomeTarget operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveOutcomeTargetInputSchema());

    const updatedDocument = reducer(document, removeOutcomeTarget(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_OUTCOME_TARGET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderOutcomeTargets operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderOutcomeTargetsInputSchema());

    const updatedDocument = reducer(document, reorderOutcomeTargets(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_OUTCOME_TARGETS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
