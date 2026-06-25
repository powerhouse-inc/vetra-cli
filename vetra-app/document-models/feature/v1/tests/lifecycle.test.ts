import { generateMock } from "document-model";
import {
  archiveFeature,
  ArchiveFeatureInputSchema,
  clearPromotion,
  ClearPromotionInputSchema,
  commitFeature,
  CommitFeatureInputSchema,
  isFeatureDocument,
  parkFeature,
  ParkFeatureInputSchema,
  promoteToSpec,
  PromoteToSpecInputSchema,
  reducer,
  reopenFeature,
  ReopenFeatureInputSchema,
  startEvaluation,
  StartEvaluationInputSchema,
  utils,
} from "document-models/feature/v1";
import { describe, expect, it } from "vitest";

describe("LifecycleOperations", () => {
  it("should handle startEvaluation operation", () => {
    const document = utils.createDocument();
    const input = generateMock(StartEvaluationInputSchema());

    const updatedDocument = reducer(document, startEvaluation(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "START_EVALUATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle commitFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CommitFeatureInputSchema());

    const updatedDocument = reducer(document, commitFeature(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "COMMIT_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle promoteToSpec operation", () => {
    const document = utils.createDocument();
    const input = generateMock(PromoteToSpecInputSchema(), {
      promotedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, promoteToSpec(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "PROMOTE_TO_SPEC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle archiveFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ArchiveFeatureInputSchema());

    const updatedDocument = reducer(document, archiveFeature(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ARCHIVE_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle parkFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ParkFeatureInputSchema());

    const updatedDocument = reducer(document, parkFeature(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "PARK_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reopenFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReopenFeatureInputSchema());

    const updatedDocument = reducer(document, reopenFeature(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REOPEN_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearPromotion operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearPromotionInputSchema());

    const updatedDocument = reducer(document, clearPromotion(input));

    expect(isFeatureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_PROMOTION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
