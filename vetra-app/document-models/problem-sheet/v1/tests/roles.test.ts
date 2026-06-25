import { generateMock } from "document-model";
import {
  addRole,
  AddRoleInputSchema,
  addSpecializedJobStep,
  AddSpecializedJobStepInputSchema,
  clearRoleSpecializedJob,
  ClearRoleSpecializedJobInputSchema,
  isProblemSheetDocument,
  reducer,
  removeRole,
  RemoveRoleInputSchema,
  removeSpecializedJobStep,
  RemoveSpecializedJobStepInputSchema,
  reorderRoles,
  ReorderRolesInputSchema,
  reorderSpecializedJobSteps,
  ReorderSpecializedJobStepsInputSchema,
  setRoleSpecializedJob,
  SetRoleSpecializedJobInputSchema,
  updateRole,
  UpdateRoleInputSchema,
  updateRoleSpecializedJob,
  UpdateRoleSpecializedJobInputSchema,
  updateSpecializedJobStep,
  UpdateSpecializedJobStepInputSchema,
  utils,
} from "document-models/problem-sheet/v1";
import { describe, expect, it } from "vitest";

describe("RolesOperations", () => {
  it("should handle addRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddRoleInputSchema());

    const updatedDocument = reducer(document, addRole(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_ROLE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateRoleInputSchema());

    const updatedDocument = reducer(document, updateRole(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_ROLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveRoleInputSchema());

    const updatedDocument = reducer(document, removeRole(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_ROLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderRoles operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderRolesInputSchema());

    const updatedDocument = reducer(document, reorderRoles(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_ROLES",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setRoleSpecializedJob operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetRoleSpecializedJobInputSchema());

    const updatedDocument = reducer(document, setRoleSpecializedJob(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_ROLE_SPECIALIZED_JOB",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateRoleSpecializedJob operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateRoleSpecializedJobInputSchema());

    const updatedDocument = reducer(document, updateRoleSpecializedJob(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_ROLE_SPECIALIZED_JOB",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearRoleSpecializedJob operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearRoleSpecializedJobInputSchema());

    const updatedDocument = reducer(document, clearRoleSpecializedJob(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_ROLE_SPECIALIZED_JOB",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addSpecializedJobStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddSpecializedJobStepInputSchema());

    const updatedDocument = reducer(document, addSpecializedJobStep(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_SPECIALIZED_JOB_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateSpecializedJobStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateSpecializedJobStepInputSchema());

    const updatedDocument = reducer(document, updateSpecializedJobStep(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_SPECIALIZED_JOB_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeSpecializedJobStep operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveSpecializedJobStepInputSchema());

    const updatedDocument = reducer(document, removeSpecializedJobStep(input));

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_SPECIALIZED_JOB_STEP",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderSpecializedJobSteps operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderSpecializedJobStepsInputSchema());

    const updatedDocument = reducer(
      document,
      reorderSpecializedJobSteps(input),
    );

    expect(isProblemSheetDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_SPECIALIZED_JOB_STEPS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
