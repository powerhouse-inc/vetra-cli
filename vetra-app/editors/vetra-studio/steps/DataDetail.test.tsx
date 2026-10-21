// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import { DataDetail } from "./DataDetail.js";
import { plainModel } from "./plainModel.js";

const SCHEMA =
  "type TaskBoardState { tasks: [Task!]! }\ntype Task { id: OID! title: String }";

describe("DataDetail", () => {
  it("shows each model in plain words and the schema on request", () => {
    const model = plainModel({
      name: "Task board",
      specifications: [
        {
          state: { global: { schema: SCHEMA } },
          modules: [{ operations: [{ name: "ADD_TASK" }] }],
        },
      ],
    });
    const container = render(<DataDetail models={[{ id: "m1", model }]} />);
    expect(container.textContent).toContain("A Task board has tasks.");
    expect(container.textContent).toContain("A Task has a title.");
    expect(container.textContent).toContain("You can: Add task.");
    expect(container.querySelector("pre")).toBeNull();
    expectNoForbiddenWords(container);

    click(button(container, "Show schema"));
    expect(container.querySelector("pre")?.textContent).toBe(SCHEMA);
    expect(button(container, "Hide schema")).toBeDefined();
  });

  it("says when there is no data yet", () => {
    const container = render(<DataDetail models={[]} />);
    expect(container.textContent).toContain(
      "The data appears here as soon as it is designed.",
    );
  });
});
