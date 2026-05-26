import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allOperationNamesCanonical,
  boundedToolCalls,
  finalCheckClean,
  neverEditedGenFiles,
  noReleaseBeforeModules,
  respondsToDiagnostics,
} from "./assertions.js";
import { parseAgentLog } from "./log-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

/* ------------------------------------------------------------------ */
/* Sanity check the parser on a real session log                       */
/* ------------------------------------------------------------------ */
describe("log-parser", () => {
  it("parses the clean session into a non-trivial event list", () => {
    const events = parseAgentLog(loadFixture("clean.md"));
    expect(events.length).toBeGreaterThan(20);

    const userMsgs = events.filter((e) => e.kind === "user_message");
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);

    const toolUses = events.filter((e) => e.kind === "tool_use");
    expect(toolUses.length).toBeGreaterThan(5);
    // Pairs balance: each tool_use should have a matching tool_result.
    const toolResults = events.filter((e) => e.kind === "tool_result");
    expect(toolResults.length).toBeGreaterThanOrEqual(toolUses.length - 1);
  });

  it("extracts the user's first prompt", () => {
    const events = parseAgentLog(loadFixture("clean.md"));
    const firstUser = events.find((e) => e.kind === "user_message");
    expect(firstUser?.content).toMatch(/workout tracker/i);
  });

  it("parses tool inputs as structured JSON", () => {
    const events = parseAgentLog(loadFixture("clean.md"));
    const init = events.find(
      (e) => e.kind === "tool_use" && e.tool === "reactor-project-init",
    );
    expect(init).toBeDefined();
    expect(init?.kind).toBe("tool_use");
    const input = (init as { input: Record<string, unknown> }).input;
    expect(input.name).toBe("workout-tracker");
  });
});

/* ------------------------------------------------------------------ */
/* Assertions on the real clean session — should all pass              */
/* ------------------------------------------------------------------ */
describe("assertions on clean.md (real session)", () => {
  const events = parseAgentLog(loadFixture("clean.md"));

  it("never edits gen files", () => {
    expect(neverEditedGenFiles(events)).toEqual({ passed: true, violations: [] });
  });

  it("never releases a new version before modules exist", () => {
    expect(noReleaseBeforeModules(events)).toEqual({ passed: true, violations: [] });
  });

  it("uses SCREAMING_SNAKE_CASE for all operation names", () => {
    expect(allOperationNamesCanonical(events)).toEqual({
      passed: true,
      violations: [],
    });
  });

  it("ends with clean diagnostics", () => {
    const r = finalCheckClean(events);
    expect(r.passed).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Synthetic minimal fixtures — each isolates one foot-gun             */
/* ------------------------------------------------------------------ */
function userPrompt(text: string): string {
  return `## User Message
**Time**: 2026-01-01T00:00:00.000Z
\`\`\`\`md
${text}
\`\`\`\`
`;
}

function toolUse(tool: string, input: unknown, t = "00:00:01"): string {
  return `## Tool Use: ${tool}
**Time**: 2026-01-01T${t}.000Z
**Call ID**: toolu_${tool}_${t}
**Input**:
\`\`\`\`json
${JSON.stringify(input, null, 2)}
\`\`\`\`
`;
}

function toolResult(tool: string, output: unknown, t = "00:00:02"): string {
  return `## Tool Result: ${tool}
**Time**: 2026-01-01T${t}.000Z
**Call ID**: toolu_${tool}_${t}
**Output**:
\`\`\`\`json
${JSON.stringify(output, null, 2)}
\`\`\`\`
`;
}

describe("synthetic fixtures — assertions catch foot-guns", () => {
  it("flags mastra_workspace_edit_file on a /gen/ path", () => {
    const log =
      userPrompt("hi") +
      toolUse("mastra_workspace_edit_file", {
        path: "project/document-models/foo/v1/gen/actions.ts",
        old_string: "a",
        new_string: "b",
      });
    const r = neverEditedGenFiles(parseAgentLog(log));
    expect(r.passed).toBe(false);
    expect(r.violations[0].message).toMatch(/generated files are off-limits/);
  });

  it("does NOT flag edits to non-gen scaffold files (editor.tsx)", () => {
    const log =
      userPrompt("hi") +
      toolUse("mastra_workspace_edit_file", {
        path: "project/editors/foo/editor.tsx",
        old_string: "a",
        new_string: "b",
      });
    expect(neverEditedGenFiles(parseAgentLog(log))).toEqual({
      passed: true,
      violations: [],
    });
  });

  it("flags RELEASE_NEW_VERSION before any ADD_MODULE", () => {
    const log =
      userPrompt("hi") +
      toolUse("spec-update", {
        name: "Foo",
        actions: [
          { type: "SET_MODEL_NAME", input: { name: "Foo" } },
          { type: "RELEASE_NEW_VERSION", input: {} },
        ],
      });
    const r = noReleaseBeforeModules(parseAgentLog(log));
    expect(r.passed).toBe(false);
    expect(r.violations[0].message).toMatch(/seals an empty spec/);
  });

  it("does NOT flag RELEASE_NEW_VERSION when a module exists", () => {
    const log =
      userPrompt("hi") +
      toolUse("spec-update", {
        name: "Foo",
        actions: [
          { type: "ADD_MODULE", input: { id: "m", name: "M" } },
          { type: "ADD_OPERATION", input: { moduleId: "m", id: "addX", name: "ADD_X", schema: "input AddXInput { _: Boolean }" } },
          { type: "RELEASE_NEW_VERSION", input: {} },
        ],
      });
    expect(noReleaseBeforeModules(parseAgentLog(log))).toEqual({
      passed: true,
      violations: [],
    });
  });

  it("flags non-canonical operation names", () => {
    const log =
      userPrompt("hi") +
      toolUse("spec-update", {
        name: "Foo",
        actions: [
          {
            type: "ADD_OPERATION",
            input: {
              moduleId: "m",
              id: "addWorkout",
              name: "Add Workout",
              schema: "input AddWorkoutInput { _: Boolean }",
            },
          },
        ],
      });
    const r = allOperationNamesCanonical(parseAgentLog(log));
    expect(r.passed).toBe(false);
    expect(r.violations[0].message).toMatch(/name="Add Workout"/);
  });

  it("flags advancing to spec-preview-create while diagnostics are open", () => {
    const log =
      userPrompt("hi") +
      toolUse("spec-generate", { project: "p" }, "00:00:01") +
      toolResult(
        "spec-generate",
        {
          text: "Generated 1 module(s). ...",
          data: {
            generated: [{ name: "Foo", type: "powerhouse/document-model" }],
            skipped: [],
            diagnostics: [
              {
                source: "tsc",
                file: "document-models/foo/v1/gen/actions.ts",
                line: 10,
                column: 36,
                severity: "error",
                code: "TS1110",
                message: "Type expected.",
              },
            ],
            checkNotes: [],
          },
        },
        "00:00:02",
      ) +
      toolUse("spec-preview-create", { name: "demo", project: "p" }, "00:00:03");
    const r = respondsToDiagnostics(parseAgentLog(log));
    expect(r.passed).toBe(false);
    expect(r.violations[0].message).toMatch(/Advanced to spec-preview-create/);
  });

  it("passes when the next action after diagnostics is a remediation", () => {
    const log =
      userPrompt("hi") +
      toolUse("spec-generate", { project: "p" }, "00:00:01") +
      toolResult(
        "spec-generate",
        {
          text: "...",
          data: {
            generated: [{ name: "Foo", type: "powerhouse/document-model" }],
            skipped: [],
            diagnostics: [
              { source: "tsc", file: "x.ts", line: 1, column: 1, severity: "error", code: "TS1110", message: "Type expected." },
            ],
            checkNotes: [],
          },
        },
        "00:00:02",
      ) +
      toolUse("spec-update", { name: "Foo", actions: [] }, "00:00:03");
    expect(respondsToDiagnostics(parseAgentLog(log))).toEqual({
      passed: true,
      violations: [],
    });
  });

  it("flags a session that ends with non-empty diagnostics", () => {
    const log =
      userPrompt("hi") +
      toolUse("reactor-project-check", { name: "p" }, "00:00:01") +
      toolResult(
        "reactor-project-check",
        {
          text: "...",
          data: {
            diagnostics: [
              { source: "tsc", file: "x.ts", line: 1, column: 1, severity: "error", code: "TS1110", message: "..." },
            ],
            summary: { errors: 1, warnings: 0, tsc: 1, eslint: 0 },
            notes: [],
            scope: "generated",
          },
        },
        "00:00:02",
      );
    const r = finalCheckClean(parseAgentLog(log));
    expect(r.passed).toBe(false);
    expect(r.violations[0].message).toMatch(/Final reactor-project-check reported 1 diagnostic/);
  });

  it("flags runaway sessions over the budget", () => {
    let log = userPrompt("hi");
    for (let i = 0; i < 50; i++) {
      log += toolUse("spec-list", {}, `00:00:${String(i).padStart(2, "0")}`);
    }
    const events = parseAgentLog(log);
    const r = boundedToolCalls(events, 40);
    expect(r.passed).toBe(false);
    expect(r.violations[0].message).toMatch(/exceeded the budget of 40/);
  });
});
