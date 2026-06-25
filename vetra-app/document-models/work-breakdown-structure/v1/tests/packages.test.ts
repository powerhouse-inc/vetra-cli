import { generateMock } from "document-model";
import {
  addPackage,
  AddPackageInputSchema,
  isWorkBreakdownStructureDocument,
  movePackage,
  MovePackageInputSchema,
  reducer,
  removePackage,
  RemovePackageInputSchema,
  reorderPackages,
  ReorderPackagesInputSchema,
  updatePackage,
  UpdatePackageInputSchema,
  utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

describe("PackagesOperations", () => {
  it("should handle addPackage operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddPackageInputSchema());

    const updatedDocument = reducer(document, addPackage(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_PACKAGE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updatePackage operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdatePackageInputSchema());

    const updatedDocument = reducer(document, updatePackage(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_PACKAGE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle movePackage operation", () => {
    const document = utils.createDocument();
    const input = generateMock(MovePackageInputSchema());

    const updatedDocument = reducer(document, movePackage(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "MOVE_PACKAGE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removePackage operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemovePackageInputSchema());

    const updatedDocument = reducer(document, removePackage(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_PACKAGE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderPackages operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderPackagesInputSchema());

    const updatedDocument = reducer(document, reorderPackages(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_PACKAGES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
