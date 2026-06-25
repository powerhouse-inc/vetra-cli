import { generateMock } from "document-model";
import {
  addJobStep,
  AddJobStepInputSchema,
  isProblemSheetDocument,
  reducer,
  removeJobStep,
  RemoveJobStepInputSchema,
  reorderJobSteps,
  ReorderJobStepsInputSchema,
  updateJobStep,
  UpdateJobStepInputSchema,
  utils,
} from "document-models/problem-sheet/v1";
import { describe, expect, it } from "vitest";

describe("JobStepsOperations", () => {
  it("should handle addJobStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddJobStepInputSchema());

    const updatedDocument = reducer(document, addJobStep(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_JOB_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateJobStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateJobStepInputSchema());

    const updatedDocument = reducer(document, updateJobStep(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_JOB_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeJobStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveJobStepInputSchema());

    const updatedDocument = reducer(document, removeJobStep(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_JOB_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderJobSteps operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderJobStepsInputSchema());

    const updatedDocument = reducer(document, reorderJobSteps(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_JOB_STEPS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
