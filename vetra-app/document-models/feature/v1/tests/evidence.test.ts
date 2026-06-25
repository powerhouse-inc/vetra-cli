import { generateMock } from "document-model";
import {
  addEvidence,
  AddEvidenceInputSchema,
  isFeatureDocument,
  reducer,
  removeEvidence,
  RemoveEvidenceInputSchema,
  updateEvidence,
  UpdateEvidenceInputSchema,
  utils,
} from "document-models/feature/v1";
import { describe, expect, it } from "vitest";

describe("EvidenceOperations", () => {
  it("should handle addEvidence operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddEvidenceInputSchema(), {
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, addEvidence(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_EVIDENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateEvidence operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateEvidenceInputSchema(), {
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, updateEvidence(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_EVIDENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeEvidence operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveEvidenceInputSchema());

    const updatedDocument = reducer(document, removeEvidence(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_EVIDENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
