import { describe, expect, it } from "vitest";
import type { CheckRun } from "document-models/studio-product";
import {
  activitySummary,
  foldedFailures,
  toolIntent,
  type Intent,
} from "./activity.js";
import { atSec, toolCall } from "./storyFixtures.js";

/** Tool ids from vetra-cli/src/agents/phase-tools.ts (ALWAYS_ON + PHASE_TOOLS). */
const AGENT_TOOL_IDS = [
  "mastra_workspace_read_file",
  "mastra_workspace_list_files",
  "mastra_workspace_file_stat",
  "mastra_workspace_grep",
  "product-progress",
  "skill",
  "skill_read",
  "skill_search",
  "whoami",
  "reactor-project-ls",
  "reactor-project-ps",
  "reactor-project-logs",
  "attachment-stat",
  "attachment-get",
  "spec-create",
  "spec-update",
  "spec-get",
  "spec-list",
  "spec-schema",
  "spec-schema-list",
  "spec-generate",
  "spec-delete",
  "spec-extract",
  "spec-preview-start",
  "spec-preview-update",
  "reactor-project-init",
  "reactor-project-start",
  "reactor-project-stop",
  "reactor-project-restart",
  "reactor-project-check",
  "reactor-project-build",
  "reactor-project-mcp__createDocument",
  "attachment-preprocess",
  "attachment-upload",
  "agent-agentDocumentModel",
  "agent-agentEditor",
  "agent-agentApp",
  "mastra_workspace_write_file",
  "mastra_workspace_edit_file",
  "mastra_workspace_execute_command",
];

const INTENTS: Intent[] = [
  "reading",
  "specs",
  "code",
  "checks",
  "preview",
  "publishing",
  "other",
];

function run(id: string, ...passed: boolean[]): CheckRun {
  return {
    id,
    at: atSec(1, 0),
    results: passed.map((p) => ({
      kind: "TYPECHECK",
      passed: p,
      reason: null,
    })),
  };
}

let n = 0;
function calls(
  count: number,
  name: string,
  args: (i: number) => Record<string, unknown>,
) {
  return Array.from({ length: count }, (_, i) =>
    toolCall(`c${n++}`, name, args(i), atSec(1, 0)),
  );
}

describe("toolIntent", () => {
  it("every tool id the agent can call maps to an intent", () => {
    for (const id of AGENT_TOOL_IDS) {
      expect(INTENTS).toContain(toolIntent(id, {}));
    }
  });

  it("follows the intent table", () => {
    expect(toolIntent("Read", {})).toBe("reading");
    expect(toolIntent("skill_read", {})).toBe("reading");
    expect(toolIntent("spec-update", {})).toBe("specs");
    expect(toolIntent("spec-generate", {})).toBe("code");
    expect(toolIntent("spec-preview-start", {})).toBe("preview");
    expect(toolIntent("mastra_workspace_edit_file", {})).toBe("code");
    expect(toolIntent("agent-agentEditor", {})).toBe("code");
    expect(toolIntent("reactor-project-check", {})).toBe("checks");
    expect(toolIntent("Bash", { command: "pnpm tsc" })).toBe("checks");
    expect(toolIntent("Bash", { command: "ls" })).toBe("other");
    expect(toolIntent("reactor-project-restart", {})).toBe("preview");
    expect(toolIntent("reactor-project-publish-status", {})).toBe("publishing");
    expect(toolIntent("deploy-environment-x", {})).toBe("publishing");
    expect(toolIntent("github-push", {})).toBe("publishing");
    expect(toolIntent("product-progress", {})).toBe("other");
    expect(toolIntent("whoami", {})).toBe("other");
  });
});

describe("activitySummary", () => {
  it("summary of a 60-step milestone is one line", () => {
    const messages = [
      ...calls(20, "Read", (i) => ({ file_path: `/p/a${i}.ts` })),
      ...calls(3, "spec-create", (i) => ({ name: `Spec ${i}` })),
      ...calls(1, "spec-generate", () => ({})),
      ...calls(30, "Write", (i) => ({ file_path: `/p/f${i}.ts` })),
      ...calls(3, "reactor-project-restart", () => ({})),
    ];
    const runs = [run("r1", true, false), run("r2", false), run("r3", true)];
    const line = activitySummary(messages, runs);
    expect(line).toBe(
      "Read the project · Wrote 3 specs · generated code · checks passed after 3 tries · updated the preview",
    );
    expect(line).not.toContain("\n");
  });

  it("counts distinct files and falls back to plain wording", () => {
    const messages = [
      ...calls(2, "Write", () => ({ file_path: "/p/a.ts" })),
      ...calls(1, "spec-get", () => ({})),
    ];
    expect(activitySummary(messages, [run("r1", true)])).toBe(
      "Worked on the design · wrote 1 file · checks passed",
    );
  });

  it("latest run failing reads checks failing", () => {
    const line = activitySummary([], [run("r1", true), run("r2", false)]);
    expect(line).toBe("Checks failing");
  });

  it("says got it ready to go live for publishing", () => {
    expect(
      activitySummary(
        calls(1, "reactor-project-publish", () => ({})),
        [],
      ),
    ).toBe("Got it ready to go live");
  });

  it("product-progress calls never appear", () => {
    expect(
      activitySummary(
        calls(4, "product-progress", () => ({})),
        [],
      ),
    ).toBe("");
    expect(activitySummary([], [])).toBe("");
  });
});

describe("foldedFailures", () => {
  it("open is the latest failing run", () => {
    const failing = run("r2", false);
    expect(foldedFailures([run("r1", true), failing])).toEqual({
      recovered: false,
      open: failing,
    });
  });

  it("recovered when an earlier run failed and the latest passed", () => {
    expect(foldedFailures([run("r1", false), run("r2", true)])).toEqual({
      recovered: true,
      open: null,
    });
    expect(foldedFailures([run("r1", true)])).toEqual({
      recovered: false,
      open: null,
    });
    expect(foldedFailures([])).toEqual({ recovered: false, open: null });
  });
});
