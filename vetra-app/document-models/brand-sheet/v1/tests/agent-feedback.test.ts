import { generateMock } from "document-model";
import {
  addSuggestion,
  AddSuggestionInputSchema,
  isBrandSheetDocument,
  reducer,
  removeSuggestion,
  RemoveSuggestionInputSchema,
  resolveSuggestion,
  ResolveSuggestionInputSchema,
  setReadyForFeedback,
  SetReadyForFeedbackInputSchema,
  utils,
} from "document-models/brand-sheet/v1";
import { describe, expect, it } from "vitest";

describe("AgentFeedbackOperations", () => {
  it("should handle setReadyForFeedback operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetReadyForFeedbackInputSchema());

    const updatedDocument = reducer(document, setReadyForFeedback(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_READY_FOR_FEEDBACK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addSuggestion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddSuggestionInputSchema(), {
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, addSuggestion(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_SUGGESTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle resolveSuggestion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ResolveSuggestionInputSchema(), {
      resolvedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, resolveSuggestion(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "RESOLVE_SUGGESTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeSuggestion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveSuggestionInputSchema());

    const updatedDocument = reducer(document, removeSuggestion(input));

    expect(isBrandSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_SUGGESTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
