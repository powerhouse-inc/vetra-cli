/**
 * gen-guard / ts-check tool wraps: argument extraction and arity.
 *
 * Mastra invokes a workspace tool as `execute(args, toolContext)` with flat
 * args (`{ path, content, ... }`). The wraps must read the path from the
 * first argument (flat or createTool-style `{ context: { path } }`) and
 * forward every invocation argument to the inner execute.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { genGuard, extractPath, isCodegenPath } from "../../src/lifecycle/gen-guard.js";
import { tsCheck } from "../../src/lifecycle/ts-check.js";
import type { LifecycleHook } from "@powerhousedao/ph-clint";

type ToolWrap = NonNullable<
  NonNullable<Awaited<ReturnType<LifecycleHook["onInit"]>>["contribute"]>["tool"]
>;

const initCtx = {
  config: {},
  cliName: "vetra",
  cliVersion: "0.0.0",
  log: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
  eventBus: {},
  userStoreFolder: "/tmp/vetra-test-store",
  isInteractive: false,
  bootTimings: { bootStartedAt: 0, configResolvedAt: 0, lifecycleInitStartedAt: 0 },
} as unknown as Parameters<LifecycleHook["onInit"]>[0];

async function toolWrapOf(hook: LifecycleHook): Promise<ToolWrap> {
  const handle = await hook.onInit(initCtx);
  const wrap = handle.contribute?.tool;
  expect(wrap).toBeDefined();
  return wrap!;
}

describe("extractPath", () => {
  it("reads the flat mastra shape { path }", () => {
    expect(extractPath({ path: "src/a.ts", content: "x" })).toBe("src/a.ts");
  });

  it("reads the nested createTool shape { context: { path } }", () => {
    expect(extractPath({ context: { path: "src/a.ts" } })).toBe("src/a.ts");
  });

  it("prefers the flat path over a nested one", () => {
    expect(extractPath({ path: "flat.ts", context: { path: "nested.ts" } })).toBe("flat.ts");
  });

  it("returns undefined for missing/empty/non-object input", () => {
    expect(extractPath({})).toBeUndefined();
    expect(extractPath({ path: "" })).toBeUndefined();
    expect(extractPath({ context: {} })).toBeUndefined();
    expect(extractPath(null)).toBeUndefined();
    expect(extractPath("path")).toBeUndefined();
  });
});

describe("genGuard tool wrap", () => {
  it("leaves non-write tools untouched", async () => {
    const wrap = await toolWrapOf(genGuard());
    const tool = { execute: jest.fn() };
    expect(wrap("mastra_workspace_read_file", tool)).toBe(tool);
  });

  it("blocks gen/ writes before the inner execute runs (flat args)", async () => {
    const wrap = await toolWrapOf(genGuard());
    const inner = jest.fn();
    const wrapped = wrap("mastra_workspace_write_file", { execute: inner });
    expect(() =>
      wrapped.execute({ path: "document-models/todo/v1/gen/schema.ts", content: "x" }, {}),
    ).toThrow(/codegen/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("blocks gen/ writes given the nested context shape", async () => {
    const wrap = await toolWrapOf(genGuard());
    const inner = jest.fn();
    const wrapped = wrap("mastra_workspace_edit_file", { execute: inner });
    expect(() =>
      wrapped.execute({ context: { path: "document-models/todo/gen/types.ts" } }, {}),
    ).toThrow(/codegen/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("forwards all invocation arguments for allowed paths", async () => {
    const wrap = await toolWrapOf(genGuard());
    const inner = jest.fn(() => "ok");
    const wrapped = wrap("mastra_workspace_write_file", { execute: inner });
    const args = { path: "editors/todo/editor.tsx", content: "x" };
    const toolContext = { workspace: {}, requestContext: {} };
    expect(wrapped.execute(args, toolContext)).toBe("ok");
    expect(inner).toHaveBeenCalledWith(args, toolContext);
  });
});

describe("tsCheck tool wrap", () => {
  it("leaves non-write tools untouched", async () => {
    const wrap = await toolWrapOf(tsCheck());
    const tool = { execute: jest.fn() };
    expect(wrap("mastra_workspace_list_files", tool)).toBe(tool);
  });

  it("forwards all invocation arguments and returns the inner result", async () => {
    const wrap = await toolWrapOf(tsCheck());
    const inner = jest.fn(async () => ({ success: true }));
    const wrapped = wrap("mastra_workspace_write_file", { execute: inner });
    const args = { path: "README.md", content: "# hi" };
    const toolContext = { workspace: {}, requestContext: {} };
    await expect(wrapped.execute(args, toolContext)).resolves.toEqual({ success: true });
    expect(inner).toHaveBeenCalledWith(args, toolContext);
  });

  it("skips checking for .ts files that do not exist on disk", async () => {
    const wrap = await toolWrapOf(tsCheck());
    const inner = jest.fn(async () => "written");
    const wrapped = wrap("mastra_workspace_edit_file", { execute: inner });
    await expect(
      wrapped.execute({ context: { path: "no/such/dir/file.ts" } }, {}),
    ).resolves.toBe("written");
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("isCodegenPath", () => {
  it("matches versioned and unversioned gen dirs only", () => {
    expect(isCodegenPath("document-models/todo/v1/gen/schema.ts")).toBe(true);
    expect(isCodegenPath("document-models/todo/gen/types.ts")).toBe(true);
    expect(isCodegenPath("document-models/todo/v1/src/reducers/todo.ts")).toBe(false);
    expect(isCodegenPath("editors/todo/editor.tsx")).toBe(false);
  });
});
