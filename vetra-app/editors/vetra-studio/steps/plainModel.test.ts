import { describe, expect, it } from "vitest";
import { plainModel, type ModelSpec } from "./plainModel.js";

function spec(schema: string, operations: string[] = []): ModelSpec {
  return {
    name: "Task board",
    specifications: [
      { state: { global: { schema } }, modules: [] },
      {
        state: { global: { schema } },
        modules: [{ operations: operations.map((name) => ({ name })) }],
      },
    ],
  };
}

const SCHEMA = `
type TaskBoardState {
  tasks: [Task!]!
}

type Task {
  id: OID!
  title: String!
  dueDate: Date
  status: TaskStatus!
  isUrgent: Boolean
  assignee: Person
}

type Person {
  id: OID!
  name: String
}

enum TaskStatus {
  TO_DO
  DOING
  DONE
}

type TaskBoardLocalState {
  draft: String
}
`;

describe("plainModel", () => {
  it("describes each data type in plain words, the model first", () => {
    const model = plainModel(spec(SCHEMA, ["ADD_TASK", "SET_TASK_STATUS"]));
    expect(model.name).toBe("Task board");
    expect(model.sentences).toEqual([
      "A Task board has tasks",
      "A Task has a title, a due date, a status (To do, Doing, Done), whether it is urgent, an assignee",
      "A Person has a name",
    ]);
    expect(model.verbs).toEqual(["Add task", "Set task status"]);
    expect(model.schema).toBe(SCHEMA);
  });

  it("a broken or missing schema still shows the name and verbs", () => {
    expect(plainModel(spec("type {", ["DELETE_TASK"]))).toEqual({
      name: "Task board",
      sentences: [],
      verbs: ["Delete task"],
      schema: "type {",
    });
    expect(plainModel({})).toEqual({
      name: "Data model",
      sentences: [],
      verbs: [],
      schema: "",
    });
  });

  it("types with only an id are left out", () => {
    const model = plainModel(
      spec("type TaskBoardState { id: OID! }\nenum Empty { A }"),
    );
    expect(model.sentences).toEqual([]);
  });
});
