import { generateMock } from "document-model";
import {
  clearCoreJob,
  ClearCoreJobInputSchema,
  isProblemSheetDocument,
  reducer,
  setCoreJob,
  SetCoreJobInputSchema,
  updateCoreJob,
  UpdateCoreJobInputSchema,
  utils,
} from "document-models/problem-sheet/v1";
import { describe, expect, it } from "vitest";

describe("CoreJobOperations", () => {
  it("should handle setCoreJob operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetCoreJobInputSchema());

    const updatedDocument = reducer(document, setCoreJob(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_CORE_JOB",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateCoreJob operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateCoreJobInputSchema());

    const updatedDocument = reducer(document, updateCoreJob(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_CORE_JOB",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearCoreJob operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearCoreJobInputSchema());

    const updatedDocument = reducer(document, clearCoreJob(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_CORE_JOB",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
