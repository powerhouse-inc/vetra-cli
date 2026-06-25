import { generateMock } from "document-model";
import {
  acceptTask,
  AcceptTaskInputSchema,
  addTask,
  addTaskDependency,
  AddTaskDependencyInputSchema,
  AddTaskInputSchema,
  addTaskOutcomeRef,
  AddTaskOutcomeRefInputSchema,
  assignTask,
  AssignTaskInputSchema,
  blockTask,
  BlockTaskInputSchema,
  clearTaskParentFeature,
  ClearTaskParentFeatureInputSchema,
  clearTaskPlannedIn,
  ClearTaskPlannedInInputSchema,
  clearTaskTargetSpec,
  ClearTaskTargetSpecInputSchema,
  dropTask,
  DropTaskInputSchema,
  isWorkBreakdownStructureDocument,
  moveTask,
  MoveTaskInputSchema,
  reducer,
  rejectTask,
  RejectTaskInputSchema,
  removeTask,
  removeTaskDependency,
  RemoveTaskDependencyInputSchema,
  RemoveTaskInputSchema,
  removeTaskOutcomeRef,
  RemoveTaskOutcomeRefInputSchema,
  reorderTaskOutcomeRefs,
  ReorderTaskOutcomeRefsInputSchema,
  reorderTasks,
  ReorderTasksInputSchema,
  setTaskParentFeature,
  SetTaskParentFeatureInputSchema,
  setTaskPlannedIn,
  SetTaskPlannedInInputSchema,
  setTaskTargetSpec,
  SetTaskTargetSpecInputSchema,
  submitTaskForReview,
  SubmitTaskForReviewInputSchema,
  unassignTask,
  UnassignTaskInputSchema,
  unblockTask,
  UnblockTaskInputSchema,
  updateTask,
  updateTaskDependencySnippet,
  UpdateTaskDependencySnippetInputSchema,
  UpdateTaskInputSchema,
  updateTaskOutcomeRefSnippet,
  UpdateTaskOutcomeRefSnippetInputSchema,
  updateTaskParentFeatureSnippet,
  UpdateTaskParentFeatureSnippetInputSchema,
  updateTaskPlannedInSnippet,
  UpdateTaskPlannedInSnippetInputSchema,
  updateTaskSessionSnippet,
  UpdateTaskSessionSnippetInputSchema,
  updateTaskTargetSpecSnippet,
  UpdateTaskTargetSpecSnippetInputSchema,
  utils,
} from "document-models/work-breakdown-structure/v1";
import { describe, expect, it } from "vitest";

describe("TasksOperations", () => {
  it("should handle addTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTaskInputSchema());

    const updatedDocument = reducer(document, addTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_TASK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTaskInputSchema());

    const updatedDocument = reducer(document, updateTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle moveTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(MoveTaskInputSchema());

    const updatedDocument = reducer(document, moveTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("MOVE_TASK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderTasks operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderTasksInputSchema());

    const updatedDocument = reducer(document, reorderTasks(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_TASKS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTaskInputSchema());

    const updatedDocument = reducer(document, removeTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setTaskTargetSpec operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetTaskTargetSpecInputSchema());

    const updatedDocument = reducer(document, setTaskTargetSpec(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_TASK_TARGET_SPEC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTaskTargetSpecSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTaskTargetSpecSnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateTaskTargetSpecSnippet(input),
    );

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TASK_TARGET_SPEC_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearTaskTargetSpec operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearTaskTargetSpecInputSchema());

    const updatedDocument = reducer(document, clearTaskTargetSpec(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_TASK_TARGET_SPEC",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setTaskParentFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetTaskParentFeatureInputSchema());

    const updatedDocument = reducer(document, setTaskParentFeature(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_TASK_PARENT_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTaskParentFeatureSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTaskParentFeatureSnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateTaskParentFeatureSnippet(input),
    );

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TASK_PARENT_FEATURE_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearTaskParentFeature operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearTaskParentFeatureInputSchema());

    const updatedDocument = reducer(document, clearTaskParentFeature(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_TASK_PARENT_FEATURE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setTaskPlannedIn operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetTaskPlannedInInputSchema());

    const updatedDocument = reducer(document, setTaskPlannedIn(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_TASK_PLANNED_IN",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTaskPlannedInSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTaskPlannedInSnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateTaskPlannedInSnippet(input),
    );

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TASK_PLANNED_IN_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle clearTaskPlannedIn operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ClearTaskPlannedInInputSchema());

    const updatedDocument = reducer(document, clearTaskPlannedIn(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "CLEAR_TASK_PLANNED_IN",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addTaskOutcomeRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTaskOutcomeRefInputSchema());

    const updatedDocument = reducer(document, addTaskOutcomeRef(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_TASK_OUTCOME_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTaskOutcomeRefSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTaskOutcomeRefSnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateTaskOutcomeRefSnippet(input),
    );

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TASK_OUTCOME_REF_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTaskOutcomeRef operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTaskOutcomeRefInputSchema());

    const updatedDocument = reducer(document, removeTaskOutcomeRef(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TASK_OUTCOME_REF",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle reorderTaskOutcomeRefs operation", () => {
    const document = utils.createDocument();
    const input = generateMock(ReorderTaskOutcomeRefsInputSchema());

    const updatedDocument = reducer(document, reorderTaskOutcomeRefs(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REORDER_TASK_OUTCOME_REFS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addTaskDependency operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTaskDependencyInputSchema());

    const updatedDocument = reducer(document, addTaskDependency(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_TASK_DEPENDENCY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTaskDependencySnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTaskDependencySnippetInputSchema());

    const updatedDocument = reducer(
      document,
      updateTaskDependencySnippet(input),
    );

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TASK_DEPENDENCY_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTaskDependency operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTaskDependencyInputSchema());

    const updatedDocument = reducer(document, removeTaskDependency(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TASK_DEPENDENCY",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle assignTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AssignTaskInputSchema(), {
      startedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, assignTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ASSIGN_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTaskSessionSnippet operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTaskSessionSnippetInputSchema());

    const updatedDocument = reducer(document, updateTaskSessionSnippet(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TASK_SESSION_SNIPPET",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle unassignTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UnassignTaskInputSchema());

    const updatedDocument = reducer(document, unassignTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UNASSIGN_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle submitTaskForReview operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SubmitTaskForReviewInputSchema());

    const updatedDocument = reducer(document, submitTaskForReview(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SUBMIT_TASK_FOR_REVIEW",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle acceptTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AcceptTaskInputSchema(), {
      completedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, acceptTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ACCEPT_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle rejectTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RejectTaskInputSchema());

    const updatedDocument = reducer(document, rejectTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REJECT_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle blockTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(BlockTaskInputSchema());

    const updatedDocument = reducer(document, blockTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("BLOCK_TASK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle unblockTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UnblockTaskInputSchema());

    const updatedDocument = reducer(document, unblockTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UNBLOCK_TASK",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle dropTask operation", () => {
    const document = utils.createDocument();
    const input = generateMock(DropTaskInputSchema());

    const updatedDocument = reducer(document, dropTask(input));

    expect(isWorkBreakdownStructureDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("DROP_TASK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
