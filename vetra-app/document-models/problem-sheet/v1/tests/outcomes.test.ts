import { generateMock } from "document-model";
import {
  addOutcome,
  AddOutcomeInputSchema,
  clearOutcomeMetric,
  ClearOutcomeMetricInputSchema,
  clearOutcomeRole,
  ClearOutcomeRoleInputSchema,
  clearOutcomeStep,
  ClearOutcomeStepInputSchema,
  isProblemSheetDocument,
  reducer,
  removeOutcome,
  RemoveOutcomeInputSchema,
  reorderOutcomes,
  ReorderOutcomesInputSchema,
  updateOutcome,
  UpdateOutcomeInputSchema,
  utils,
} from "document-models/problem-sheet/v1";
import { describe, expect, it } from "vitest";

describe("OutcomesOperations", () => {
  it("should handle addOutcome operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddOutcomeInputSchema());

    const updatedDocument = reducer(document, addOutcome(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_OUTCOME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateOutcome operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateOutcomeInputSchema());

    const updatedDocument = reducer(document, updateOutcome(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_OUTCOME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeOutcome operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveOutcomeInputSchema());

    const updatedDocument = reducer(document, removeOutcome(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_OUTCOME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderOutcomes operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderOutcomesInputSchema());

    const updatedDocument = reducer(document, reorderOutcomes(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_OUTCOMES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearOutcomeMetric operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearOutcomeMetricInputSchema());

    const updatedDocument = reducer(document, clearOutcomeMetric(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_OUTCOME_METRIC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearOutcomeRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearOutcomeRoleInputSchema());

    const updatedDocument = reducer(document, clearOutcomeRole(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_OUTCOME_ROLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearOutcomeStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearOutcomeStepInputSchema());

    const updatedDocument = reducer(document, clearOutcomeStep(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_OUTCOME_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
