// @vitest-environment happy-dom
import type { PHDocument } from "document-model";
import { describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import { file } from "../test-utils/studioFixtures.js";
import { PlanDetail } from "./PlanDetail.js";
import { planBrief } from "./planBrief.js";

vi.mock("../ideation/DocumentHost.js", () => ({
  DocumentHost: ({ id }: { id: string }) => <div>Editing {id}</div>,
}));

function doc(id: string, documentType: string, global: object): PHDocument {
  return {
    header: { id, documentType },
    state: { global },
  } as unknown as PHDocument;
}

const NODES = [
  file("problem", "powerhouse/problem-sheet", "Problem Sheet"),
  file("audience", "powerhouse/audience-sheet", "Audience Sheet"),
  file("f1", "powerhouse/feature", "Feature 1"),
  file("other", "powerhouse/chat-session"),
];

const DOCS = [
  doc("problem", "powerhouse/problem-sheet", {
    context: "Teams lose track of who does what.",
    coreJob: null,
    coreJobSteps: [],
    roles: [],
    outcomes: [],
    constraints: [],
    agentFeedback: {},
  }),
  doc("audience", "powerhouse/audience-sheet", {
    segments: [
      {
        id: "s1",
        name: "Small teams",
        description: "up to ten people",
        roles: [],
        outcomePriorities: [],
        evidence: [],
      },
    ],
    agentFeedback: {},
  }),
  doc("f1", "powerhouse/feature", {
    name: "Assign tasks",
    summary: "Give each task an owner",
    scope: "MVP",
    targets: [],
    segments: [],
  }),
];

describe("PlanDetail", () => {
  it("shows the brief read-only and opens a document with Edit", () => {
    const container = render(
      <PlanDetail
        idea="a task board for my team"
        brief={planBrief(NODES, DOCS)}
      />,
    );
    const text = container.textContent;
    expect(text).toContain("“a task board for my team”");
    expect(text).toContain("Teams lose track of who does what.");
    expect(text).toContain("Small teams — up to ten people");
    expect(text).toContain("Assign tasks — Give each task an owner");
    expect(container.querySelector("input, textarea")).toBeNull();
    expectNoForbiddenWords(container);

    click(button(container, "Edit Feature 1"));
    expect(container.textContent).toContain("Editing f1");
    click(button(container, "Done"));
    expect(container.textContent).toContain("Assign tasks");
  });

  it("says when the plan isn't written yet", () => {
    const container = render(
      <PlanDetail idea={null} brief={planBrief([], [])} />,
    );
    expect(container.textContent).toContain(
      "The plan appears here as soon as it is written.",
    );
  });

  it("falls back to the core job when the problem has no context", () => {
    const brief = planBrief(
      [file("problem", "powerhouse/problem-sheet")],
      [
        doc("problem", "powerhouse/problem-sheet", {
          context: null,
          coreJob: {
            motivation: "NEED_TO",
            verb: "plan",
            object: "the week's work",
            clarifier: null,
          },
          coreJobSteps: [],
          roles: [],
          outcomes: [],
          constraints: [],
          agentFeedback: {},
        }),
      ],
    );
    expect(brief.problem).toBe("plan the week's work");
  });
});
