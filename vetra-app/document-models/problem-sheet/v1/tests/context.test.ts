import { generateMock } from "document-model";
import {
  clearContext,
  ClearContextInputSchema,
  isProblemSheetDocument,
  reducer,
  setContext,
  SetContextInputSchema,
  utils,
} from "document-models/problem-sheet/v1";
import { describe, expect, it } from "vitest";

describe("ContextOperations", () => {
  it("should handle setContext operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetContextInputSchema());

    const updatedDocument = reducer(document, setContext(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_CONTEXT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearContext operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearContextInputSchema());

    const updatedDocument = reducer(document, clearContext(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_CONTEXT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
