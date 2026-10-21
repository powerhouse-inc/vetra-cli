import { describe, expect, it } from "vitest";
import { forbiddenWordsIn } from "../test-utils/forbiddenWords.js";
import { doingNow } from "./doingNow.js";

describe("doingNow", () => {
  it("doing-now line names the file being written", () => {
    expect(
      doingNow({
        toolName: "mastra_workspace_write_file",
        args: { path: "editors/kitchen-queue/components/QueueBoard.tsx" },
      }),
    ).toBe("writing QueueBoard.tsx…");
    expect(
      doingNow({ toolName: "Edit", args: { file_path: "/w/src/order.ts" } }),
    ).toBe("writing order.ts…");
    expect(doingNow({ toolName: "Write", args: {} })).toBe("writing code…");
  });

  it("checks, preview and set-up read as plain words", () => {
    expect(doingNow({ toolName: "reactor-project-check", args: {} })).toBe(
      "running the checks…",
    );
    expect(
      doingNow({
        toolName: "mastra_workspace_execute_command",
        args: { command: "pnpm tsc --noEmit" },
      }),
    ).toBe("running the checks…");
    expect(doingNow({ toolName: "bash", args: { command: "ls -la" } })).toBe(
      "running a command…",
    );
    expect(doingNow({ toolName: "reactor-project-start", args: {} })).toBe(
      "starting the preview…",
    );
    expect(doingNow({ toolName: "reactor-project-init", args: {} })).toBe(
      "setting up your project…",
    );
    expect(doingNow(null)).toBe("thinking…");
  });

  it("never shows a tool id or a forbidden word", () => {
    const tools = [
      "Read",
      "Grep",
      "skill",
      "product-progress",
      "reactor-project-build",
      "reactor-project-publish",
      "reactor-project-publish-status",
      "reactor-project-restart",
      "spec-create",
      "spec-generate",
      "spec-preview-create",
      "deploy-environment-create",
      "vetra-mcp__addActions",
      "something-new",
    ];
    for (const toolName of tools) {
      const line = doingNow({ toolName, args: {} });
      expect(line).not.toContain(toolName);
      expect(line.endsWith("…")).toBe(true);
      expect(forbiddenWordsIn(line)).toEqual([]);
    }
  });
});
