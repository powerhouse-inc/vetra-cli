import { generateMock } from "document-model";
import {
  activateWbs,
  ActivateWbsInputSchema,
  archiveWbs,
  ArchiveWbsInputSchema,
  completeWbs,
  CompleteWbsInputSchema,
  isWorkBreakdownStructureDocument,
  reducer,
  reopenWbs,
  ReopenWbsInputSchema,
  utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

describe("WbsStatusOperations", () => {
  it("should handle activateWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ActivateWbsInputSchema());

    const updatedDocument = reducer(document, activateWbs(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ACTIVATE_WBS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle completeWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(CompleteWbsInputSchema());

    const updatedDocument = reducer(document, completeWbs(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "COMPLETE_WBS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle archiveWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ArchiveWbsInputSchema());

    const updatedDocument = reducer(document, archiveWbs(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ARCHIVE_WBS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reopenWbs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReopenWbsInputSchema());

    const updatedDocument = reducer(document, reopenWbs(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("REOPEN_WBS");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
