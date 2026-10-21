import { describe, it, expect, jest } from "@jest/globals";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import {
  CHECKS_REFUSAL,
  GIT_REFUSAL,
  MERGE_REFUSAL,
  extractCommand,
  refuseCommand,
  shellGuard,
} from "../../src/lifecycle/shell-guard.js";

type ToolWrap = NonNullable<
  NonNullable<Awaited<ReturnType<LifecycleHook["onInit"]>>["contribute"]>["tool"]
>;

async function toolWrap(): Promise<ToolWrap> {
  const handle = await shellGuard().onInit({} as Parameters<LifecycleHook["onInit"]>[0]);
  return handle.contribute!.tool!;
}

describe("refuseCommand", () => {
  it.each([
    "vitest run",
    "npx vitest run document-models/todo/v1/tests/tasks.test.ts 2>&1 | tail -40",
    "cd todo-list && npx vitest run",
    "./node_modules/.bin/jest",
    "npx -y tsc --noEmit",
    "eslint src",
    "oxlint .",
    "pnpm test",
    "pnpm --filter vetra test",
    "pnpm run lint",
    "pnpm typecheck",
    "pnpm build",
    "pnpm exec tsc",
    "npm test",
    "npm run build",
    "CI=1 pnpm test",
    'sh -c "vitest run"',
    'bash -lc "cd todo && pnpm test"',
    "sh -ec 'npx tsc --noEmit'",
    "node node_modules/.bin/vitest run",
    "cd todo && node ./node_modules/.bin/eslint .",
  ])("refuses check runner %s", (command) => {
    expect(refuseCommand(command)).toBe(CHECKS_REFUSAL);
  });

  it.each(["git commit -m wip", "git -C todo-list push", "cd todo-list && git push origin main"])(
    "refuses %s",
    (command) => {
      expect(refuseCommand(command)).toBe(GIT_REFUSAL);
    },
  );

  it.each(["git merge --continue", "git -C todo merge --abort", "cd todo && git merge --quit"])(
    "refuses %s (the launch finishes a merge from GitHub)",
    (command) => {
      expect(refuseCommand(command)).toBe(MERGE_REFUSAL);
    },
  );

  it.each(["git add todo/src/model.ts", "git diff --cached --stat", "git merge-base HEAD main"])(
    "allows %s while a merge is open",
    (command) => {
      expect(refuseCommand(command)).toBeNull();
    },
  );

  it.each([
    "pnpm add zod",
    "pnpm add -D @types/node",
    "pnpm install",
    "cd todo-list && pnpm install --frozen-lockfile",
    "npm install lodash",
    "npm i",
    "git status",
    "ls -la",
    "cat package.json | grep vitest",
    'bash -lc "pnpm install"',
    "node scripts/seed.js",
  ])("allows %s", (command) => {
    expect(refuseCommand(command)).toBeNull();
  });
});

describe("shellGuard tool wrap", () => {
  it("leaves other tools untouched", async () => {
    const wrap = await toolWrap();
    const tool = { execute: jest.fn() };
    expect(wrap("mastra_workspace_write_file", tool)).toBe(tool);
  });

  it("refuses before the inner execute runs and points at the recorded tools", async () => {
    const wrap = await toolWrap();
    const inner = jest.fn();
    const wrapped = wrap("mastra_workspace_execute_command", { execute: inner });
    expect(() => wrapped.execute({ command: "cd p && npx vitest run" }, {})).toThrow(
      /reactor-project-check.*tests: true.*reactor-project-build/,
    );
    expect(() => wrapped.execute({ context: { command: "git push" } }, {})).toThrow(GIT_REFUSAL);
    expect(inner).not.toHaveBeenCalled();
  });

  it("forwards installs with every argument", async () => {
    const wrap = await toolWrap();
    const inner = jest.fn(() => "ok");
    const wrapped = wrap("mastra_workspace_execute_command", { execute: inner });
    const args = { command: "pnpm add zod" };
    const ctx = { workspace: {} };
    expect(wrapped.execute(args, ctx)).toBe("ok");
    expect(inner).toHaveBeenCalledWith(args, ctx);
    expect(extractCommand(null)).toBeUndefined();
  });
});
