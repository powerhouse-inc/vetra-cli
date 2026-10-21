// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import { DataDetail } from "./DataDetail.js";
import type { PHDocument } from "document-model";

const SCHEMA =
  "type TaskBoardState { tasks: [Task!]! }\ntype Task { id: OID! title: String }";

describe("DataDetail", () => {
  it("shows each model in plain words and the schema on request", () => {
    const documents = [
      {
        header: { id: "m1", documentType: "powerhouse/document-model" },
        state: {
          global: {
            name: "Task board",
            specifications: [
              {
                state: { global: { schema: SCHEMA } },
                modules: [{ operations: [{ name: "ADD_TASK" }] }],
              },
            ],
          },
        },
      },
      {
        header: { id: "c1", documentType: "powerhouse/chat-session" },
        state: { global: {} },
      },
    ] as unknown as PHDocument[];
    const container = render(<DataDetail documents={documents} />);
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
    const container = render(<DataDetail documents={[]} />);
    expect(container.textContent).toContain(
      "The data appears here as soon as it is designed.",
    );
  });
});
