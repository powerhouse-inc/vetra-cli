import { generateMock } from "document-model";
import {
  addConstraint,
  AddConstraintInputSchema,
  isProblemSheetDocument,
  reducer,
  removeConstraint,
  RemoveConstraintInputSchema,
  reorderConstraints,
  ReorderConstraintsInputSchema,
  updateConstraint,
  UpdateConstraintInputSchema,
  utils,
} from "document-models/problem-sheet/v1";
import { describe, expect, it } from "vitest";

describe("ConstraintsOperations", () => {
  it("should handle addConstraint operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddConstraintInputSchema());

    const updatedDocument = reducer(document, addConstraint(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_CONSTRAINT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateConstraint operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateConstraintInputSchema());

    const updatedDocument = reducer(document, updateConstraint(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_CONSTRAINT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeConstraint operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveConstraintInputSchema());

    const updatedDocument = reducer(document, removeConstraint(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_CONSTRAINT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderConstraints operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderConstraintsInputSchema());

    const updatedDocument = reducer(document, reorderConstraints(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_CONSTRAINTS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
