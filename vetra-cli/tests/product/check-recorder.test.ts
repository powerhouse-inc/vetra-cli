import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StudioProductV1 } from "vetra-app/document-models";
import { checkRecorder } from "../../src/lifecycle/check-recorder.js";
import { reactorProjectCheck } from "../../src/commands/reactor-project/check.js";
import { attachCheckResults, capReason, readCheckResults } from "../../src/product/check-results.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { productHarness, type ProductHarness } from "./helpers.js";
import { runProgress } from "../../src/commands/product/progress.js";
import { specCreate } from "../../src/commands/spec/create.js";
import { specGenerate } from "../../src/commands/spec/generate.js";
import { makeCtx } from "../spec/_fixtures.js";

type Tool = { execute: (...args: unknown[]) => Promise<unknown> };

function wrapWith(h: ProductHarness, name: string, tool: Tool): Tool {
  const warnings: string[] = [];
  const handle = checkRecorder({ context: () => h.ctx }).onInit({
    log: { warn: (m: string) => warnings.push(m) },
  } as never) as { contribute: { tool: (n: string, t: Tool) => Tool } };
  return handle.contribute.tool(name, tool);
}

describe("check-recorder", () => {
  let h: ProductHarness | undefined;
  let project: string;

  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), "check-recorder-"));
    await fs.writeFile(path.join(project, "powerhouse.config.json"), "{}");
    await fs.mkdir(path.join(project, "node_modules", ".bin"), { recursive: true });
    await fs.writeFile(path.join(project, "node_modules", ".bin", "tsc"), "");
    await fs.writeFile(path.join(project, "node_modules", ".bin", "eslint"), "");
  });
  afterEach(async () => {
    await h?.kill();
    h = undefined;
    await fs.rm(project, { recursive: true, force: true });
  });

  /** A runProcess faking tsc with one error and eslint with one warning. */
  const runProcess = async (command: string) => {
    if (command.includes("tsc")) {
      return {
        success: false,
        output: "editors/todo/editor.tsx(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
      };
    }
    return {
      success: true,
      output: JSON.stringify([
        {
          filePath: path.join(project, "editors/todo/editor.tsx"),
          messages: [{ ruleId: "no-unused-vars", severity: 1, line: 1, column: 1, message: "unused" }],
        },
      ]),
    };
  };

  it("check-recorder records a failing TYPECHECK from a real check outcome", async () => {
    h = await productHarness();
    const tool = wrapWith(h, "reactor-project-check", {
      execute: (input) =>
        reactorProjectCheck.execute(input as never, { workdir: project, runProcess } as never),
    });
    const result = (await tool.execute({}, {})) as { text: string };
    expect(result.text).toContain("1 error(s), 1 warning(s)");
    // The raw diagnostic stays in the agent's text.
    expect(result.text).toContain("TS2322");
    // The observed results never reach the model's JSON.
    expect(JSON.stringify(result)).not.toContain("TYPECHECK");

    const runs = (await h.state()).changes[0].checkRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0].results).toEqual([
      {
        kind: "TYPECHECK",
        passed: false,
        reason: "1 type error, first in editors/todo/editor.tsx line 3.",
      },
      // F14: warnings alone don't fail LINT; they go into the reason.
      { kind: "LINT", passed: true, reason: "1 lint warning." },
    ]);
  });

  it("records REDUCER_TESTS and SMOKE with tests: true", async () => {
    h = await productHarness();
    await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    await fs.mkdir(path.join(project, "editors", "todo"), { recursive: true });
    await fs.writeFile(path.join(project, "editors", "todo", "editor.tsx"), "export {};");
    const commands: string[] = [];
    const tool = wrapWith(h, "reactor-project-check", {
      execute: (input) =>
        reactorProjectCheck.execute(input as never, {
          workdir: project,
          runProcess: async (command: string) => {
            commands.push(command);
            if (command.startsWith("npm run test")) {
              return { success: false, output: " FAIL  tests/todo.test.ts > adds a todo\nTests  1 failed (3)" };
            }
            if (command === "ph build") return { success: true, output: "" };
            return runProcess(command);
          },
          services: { list: () => [] },
        } as never),
    });
    const result = (await tool.execute({ tests: true }, {})) as { text: string };
    expect(commands).toEqual(expect.arrayContaining(["npm run test --silent", "ph build"]));
    expect(result.text).toContain("✗ Reducer tests");
    const kinds = (await h.state()).changes[0].checkRuns[0].results.map((r) => [r.kind, r.passed]);
    expect(kinds).toEqual([
      ["TYPECHECK", false],
      ["LINT", true],
      ["REDUCER_TESTS", false],
      // The preview is not running → the editors could not be checked.
      ["SMOKE", false],
    ]);
  });

  it("omits a skipped kind", async () => {
    h = await productHarness();
    const tool = wrapWith(h, "reactor-project-check", {
      execute: (input) =>
        reactorProjectCheck.execute(input as never, { workdir: project, runProcess } as never),
    });
    await tool.execute({ skipTypecheck: true }, {});
    const runs = (await h.state()).changes[0].checkRuns;
    expect(runs[0].results.map((r) => r.kind)).toEqual(["LINT"]);
  });

  it("check-recorder records nothing when the wrapped tool throws before running", async () => {
    h = await productHarness();
    const tool = wrapWith(h, "reactor-project-check", {
      execute: (input) =>
        reactorProjectCheck.execute(input as never, {
          workdir: path.join(project, "missing"),
          runProcess,
        } as never),
    });
    await expect(tool.execute({}, {})).rejects.toThrow();
    expect((await h.state()).changes[0].checkRuns).toEqual([]);
  });

  it("records spec-generate outcomes as GENERATE runs", async () => {
    h = await productHarness();
    await specCreate.execute({ type: "powerhouse/document-model", name: "Todo", dryRun: false }, makeCtx(project) as never);
    let codegenOk = false;
    const ctx = {
      ...makeCtx(project),
      runProcess: async () =>
        codegenOk ? { success: true, output: "" } : { success: false, output: 'Unknown type "Foo"' },
    };
    const tool = wrapWith(h, "spec-generate", {
      execute: (input) => specGenerate.execute(input as never, ctx as never),
    });
    await expect(tool.execute({ name: "Todo", skipChecks: true }, {})).rejects.toThrow(/Unknown type/);
    codegenOk = true;
    await tool.execute({ skipChecks: true }, {});
    const runs = (await h.state()).changes[0].checkRuns;
    expect(runs.map((r) => r.results)).toEqual([
      [{ kind: "GENERATE", passed: false, reason: "Code couldn't be generated for Todo." }],
      [{ kind: "GENERATE", passed: true, reason: null }],
    ]);
  });

  it("records GENERATE carried on a thrown error and rethrows it", async () => {
    h = await productHarness();
    const boom = attachCheckResults(new Error("codegen failed"), [
      { kind: "GENERATE", passed: false, reason: "Todo: Unknown type Foo" },
    ]);
    const tool = wrapWith(h, "spec-generate", { execute: async () => Promise.reject(boom) });
    await expect(tool.execute({}, {})).rejects.toBe(boom);
    const runs = (await h.state()).changes[0].checkRuns;
    expect(runs[0].results).toEqual([
      { kind: "GENERATE", passed: false, reason: "Todo: Unknown type Foo" },
    ]);
  });

  it("leaves other tools alone and skips a change that is no longer in progress", async () => {
    h = await productHarness();
    const plain = { execute: async () => attachCheckResults({ text: "x" }, [{ kind: "LINT", passed: true, reason: null }]) };
    expect(wrapWith(h, "spec-list", plain)).toBe(plain);

    await dispatchProduct(h.ctx, [
      StudioProductV1.actions.pauseChange({ changeId: "change-1", at: "2026-10-20T10:02:00.000Z" }),
    ]);
    // PAUSED is still in progress → recorded.
    await wrapWith(h, "reactor-project-check", plain).execute({}, {});
    expect((await h.state()).changes[0].checkRuns).toHaveLength(1);
  });

  it("records nothing on a change that was launched", async () => {
    h = await productHarness();
    const client = h.module.client;
    let executed = 0;
    const launched = {
      folders: {},
      reactor: async () => ({
        personalDriveId: h!.driveId,
        client: {
          get: async (id: string) => {
            const doc = (await client.get(id)) as { state: { global: { changes?: Array<{ status: string }> } } };
            for (const c of doc.state.global.changes ?? []) c.status = "LAUNCHED";
            return doc;
          },
          execute: async () => {
            executed++;
          },
        },
      }),
    };
    const handle = checkRecorder({ context: () => launched }).onInit({ log: {} } as never) as {
      contribute: { tool: (n: string, t: Tool) => Tool };
    };
    const tool = handle.contribute.tool("reactor-project-check", {
      execute: async () => attachCheckResults({ text: "x" }, [{ kind: "LINT", passed: true, reason: null }]),
    });
    await tool.execute({}, {});
    expect(executed).toBe(0);
  });

  it("never breaks the tool call when the product cannot be written", async () => {
    h = await productHarness({ product: false });
    const result = { text: "ok" };
    const tool = wrapWith(h, "reactor-project-check", {
      execute: async () => attachCheckResults(result, [{ kind: "LINT", passed: true, reason: null }]),
    });
    expect(await tool.execute({}, {})).toBe(result);
    expect(readCheckResults(result)).toHaveLength(1);
  });

  it("stamps a check with its start, so one started before generate finished is older", async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "TESTS" }] });
    let t = Date.parse("2026-10-20T11:00:00.000Z");
    const now = () => new Date((t += 1000));
    const handle = checkRecorder({ context: () => h!.ctx, now }).onInit({ log: {} } as never) as {
      contribute: { tool: (n: string, t: Tool) => Tool };
    };
    let finishCheck!: () => void;
    const check = handle.contribute.tool("reactor-project-check", {
      execute: () =>
        new Promise((resolve) => {
          finishCheck = () =>
            resolve(
              attachCheckResults({ text: "ok" }, [
                { kind: "TYPECHECK", passed: true, reason: null },
                { kind: "LINT", passed: true, reason: null },
                { kind: "REDUCER_TESTS", passed: true, reason: null },
                { kind: "SMOKE", passed: true, reason: null },
              ]),
            );
        }),
    });
    const generate = handle.contribute.tool("spec-generate", {
      execute: async () => attachCheckResults({ text: "ok" }, [{ kind: "GENERATE", passed: true, reason: null }]),
    });
    // Check starts, generate runs to completion, then the check finishes.
    const checking = check.execute({ tests: true }, {});
    await generate.execute({}, {});
    finishCheck();
    await checking;

    const runs = (await h.state()).changes[0].checkRuns;
    const gen = runs.find((r) => r.results[0].kind === "GENERATE")!;
    const chk = runs.find((r) => r.results[0].kind === "TYPECHECK")!;
    expect(Date.parse(chk.at)).toBeLessThan(Date.parse(gen.at));
    expect(await runProgress(h.ctx, { action: "done", step: "TESTS" })).toBe(
      "Refused: Tests can't be done: the latest TYPECHECK is older than GENERATE.",
    );
  });

  it("stores reasons as one plain line without local paths or forbidden words", async () => {
    h = await productHarness();
    const home = os.homedir();
    const tool = wrapWith(h, "reactor-project-check", {
      execute: async () =>
        attachCheckResults({ text: "x" }, [
          {
            kind: "SMOKE",
            passed: false,
            reason: `Failed in ${home}/projects/todo/editors/a.tsx\nthe package ${project}/editors/b.tsx\n  broke`,
          },
        ]),
    });
    await tool.execute({}, {});
    const reason = (await h.state()).changes[0].checkRuns[0].results[0].reason!;
    // The recorder doesn't know the project; any other absolute path → file name.
    expect(reason).toBe("Failed in projects/todo/editors/a.tsx the app b.tsx broke");
    expect(reason).not.toMatch(/\n|\/home\/|package/i);
    // Producers pass the project base, which becomes relative.
    expect(capReason(`Broke:\n${project}/editors/b.tsx in the Package`, { base: project })).toBe(
      "Broke: editors/b.tsx in the app",
    );
  });

  it("gives up recording after the timeout without failing the tool", async () => {
    h = await productHarness();
    const warnings: string[] = [];
    const stalled = { folders: {}, reactor: () => new Promise<never>(() => {}) };
    const handle = checkRecorder({ context: () => stalled, timeoutMs: 20 }).onInit({
      log: { warn: (m: string) => warnings.push(m) },
    } as never) as { contribute: { tool: (n: string, t: Tool) => Tool } };
    const result = { text: "ok" };
    const tool = handle.contribute.tool("reactor-project-check", {
      execute: async () => attachCheckResults(result, [{ kind: "LINT", passed: true, reason: null }]),
    });
    expect(await tool.execute({}, {})).toBe(result);
    expect(warnings[0]).toMatch(/timed out after 20 ms/);
  });

  it("the hidden results survive ph-clint's command → Mastra tool adapter", async () => {
    h = await productHarness();
    const { commandsToMastraTools } = await import("@powerhousedao/ph-clint/mastra");
    const tools = await commandsToMastraTools([reactorProjectCheck as never], {
      workdir: project,
      runProcess,
      stdout: () => {},
    } as never);
    const tool = wrapWith(h, "reactor-project-check", tools["reactor-project-check"] as unknown as Tool);
    await tool.execute({}, {});
    const runs = (await h.state()).changes[0].checkRuns;
    expect(runs[0].results.map((r) => r.kind)).toEqual(["TYPECHECK", "LINT"]);
  });
});
