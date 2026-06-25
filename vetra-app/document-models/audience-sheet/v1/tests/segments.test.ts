import { generateMock } from "document-model";
import {
  addOutcomePriority,
  AddOutcomePriorityInputSchema,
  addSegment,
  addSegmentEvidence,
  AddSegmentEvidenceInputSchema,
  AddSegmentInputSchema,
  addSegmentRole,
  AddSegmentRoleInputSchema,
  isAudienceSheetDocument,
  reducer,
  removeOutcomePriority,
  RemoveOutcomePriorityInputSchema,
  removeSegment,
  removeSegmentEvidence,
  RemoveSegmentEvidenceInputSchema,
  RemoveSegmentInputSchema,
  removeSegmentRole,
  RemoveSegmentRoleInputSchema,
  reorderOutcomePriorities,
  ReorderOutcomePrioritiesInputSchema,
  reorderSegmentRoles,
  ReorderSegmentRolesInputSchema,
  reorderSegments,
  ReorderSegmentsInputSchema,
  updateOutcomePriority,
  UpdateOutcomePriorityInputSchema,
  updateOutcomePrioritySnippet,
  UpdateOutcomePrioritySnippetInputSchema,
  updateSegment,
  updateSegmentEvidence,
  UpdateSegmentEvidenceInputSchema,
  UpdateSegmentInputSchema,
  updateSegmentRoleSnippet,
  UpdateSegmentRoleSnippetInputSchema,
  utils,
} from "document-models/audience-sheet/v1";
import { describe, expect, it } from "vitest";

describe("SegmentsOperations", () => {
  it("should handle addSegment operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddSegmentInputSchema());

    const updatedDocument = reducer(document, addSegment(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_SEGMENT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateSegment operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateSegmentInputSchema());

    const updatedDocument = reducer(document, updateSegment(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_SEGMENT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeSegment operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveSegmentInputSchema());

    const updatedDocument = reducer(document, removeSegment(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_SEGMENT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderSegments operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderSegmentsInputSchema());

    const updatedDocument = reducer(document, reorderSegments(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_SEGMENTS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addSegmentRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddSegmentRoleInputSchema());

    const updatedDocument = reducer(document, addSegmentRole(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_SEGMENT_ROLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateSegmentRoleSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateSegmentRoleSnippetInputSchema());

    const updatedDocument = reducer(document, updateSegmentRoleSnippet(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_SEGMENT_ROLE_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeSegmentRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveSegmentRoleInputSchema());

    const updatedDocument = reducer(document, removeSegmentRole(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_SEGMENT_ROLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderSegmentRoles operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderSegmentRolesInputSchema());

    const updatedDocument = reducer(document, reorderSegmentRoles(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_SEGMENT_ROLES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addOutcomePriority operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddOutcomePriorityInputSchema());

    const updatedDocument = reducer(document, addOutcomePriority(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_OUTCOME_PRIORITY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateOutcomePriority operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateOutcomePriorityInputSchema());

    const updatedDocument = reducer(document, updateOutcomePriority(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_OUTCOME_PRIORITY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateOutcomePrioritySnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateOutcomePrioritySnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateOutcomePrioritySnippet(input),
    );

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_OUTCOME_PRIORITY_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeOutcomePriority operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveOutcomePriorityInputSchema());

    const updatedDocument = reducer(document, removeOutcomePriority(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_OUTCOME_PRIORITY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderOutcomePriorities operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderOutcomePrioritiesInputSchema());

    const updatedDocument = reducer(document, reorderOutcomePriorities(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_OUTCOME_PRIORITIES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addSegmentEvidence operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddSegmentEvidenceInputSchema(), {
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, addSegmentEvidence(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_SEGMENT_EVIDENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateSegmentEvidence operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateSegmentEvidenceInputSchema(), {
      recordedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, updateSegmentEvidence(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_SEGMENT_EVIDENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeSegmentEvidence operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveSegmentEvidenceInputSchema());

    const updatedDocument = reducer(document, removeSegmentEvidence(input));

    expect(isAudienceSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_SEGMENT_EVIDENCE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
