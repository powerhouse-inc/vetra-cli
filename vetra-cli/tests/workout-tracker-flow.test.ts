import { describe, expect, it } from "@jest/globals";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "src", "main.ts");
const TSX = join(__dirname, "..", "node_modules", ".bin", "tsx");

type RunResult = { stdout: string; stderr: string; code: number };

async function run(
  opts: { workdir?: string; input?: string },
  ...args: string[]
): Promise<RunResult> {
  const cliArgs = opts.workdir ? ["-w", opts.workdir, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI_PATH, ...cliArgs], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/**
 * Replays the foot-gun sequence from the 2026-05-25 workout-tracker agent
 * session (vetra-test/.ph/vetra/logs/VetraAgent/20260525_1710_001.md) and
 * asserts each failure now produces a clear, actionable error.
 *
 * Scope: spec-* only — no `reactor-project-init`, no `spec-generate`, no
 * codegen. Those need a real project tree with node_modules and belong in a
 * heavier suite that's gated separately.
 */
describe("workout-tracker flow — agent foot-gun regressions", () => {
  const TIMEOUT = 60_000;

  async function setupProject(): Promise<string> {
    const workdir = mkdtempSync(join(tmpdir(), "vetra-flow-"));
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
    const r = await run(
      { workdir },
      "spec-create",
      "--type",
      "powerhouse/document-model",
      "--name",
      "Workout Tracker",
    );
    expect(r.code).toBe(0);
    return workdir;
  }

  it(
    "rejects SET_DESCRIPTION with a did-you-mean for SET_MODEL_DESCRIPTION",
    async () => {
      const workdir = await setupProject();
      try {
        const r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Workout Tracker",
          "--actions",
          JSON.stringify([
            { type: "SET_DESCRIPTION", input: { description: "x" } },
          ]),
        );
        expect(r.code).not.toBe(0);
        expect(r.stderr).toMatch(/SET_MODEL_DESCRIPTION/);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    "rejects SET_INITIAL_STATE when given `value` instead of `initialValue`",
    async () => {
      const workdir = await setupProject();
      try {
        const r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Workout Tracker",
          "--actions",
          JSON.stringify([
            {
              type: "SET_INITIAL_STATE",
              input: { scope: "global", value: "{}" },
            },
          ]),
        );
        expect(r.code).not.toBe(0);
        expect(r.stderr).toMatch(/initialValue/);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    "rejects ADD_OPERATION when `name` isn't SCREAMING_SNAKE_CASE",
    async () => {
      const workdir = await setupProject();
      try {
        // Module must exist before ADD_OPERATION targets it.
        let r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Workout Tracker",
          "--actions",
          JSON.stringify([
            { type: "ADD_MODULE", input: { id: "workouts", name: "Workouts" } },
          ]),
        );
        expect(r.code).toBe(0);

        r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Workout Tracker",
          "--actions",
          JSON.stringify([
            {
              type: "ADD_OPERATION",
              input: {
                moduleId: "workouts",
                id: "addWorkout",
                name: "Add Workout",
                schema: "input AddWorkoutInput { id: String! }",
              },
            },
          ]),
        );
        expect(r.code).not.toBe(0);
        expect(r.stderr).toMatch(/invalid/i);
        expect(r.stderr).toMatch(/ADD_WORKOUT/); // suggestion
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    "accepts ADD_OPERATION when `name` is SCREAMING_SNAKE_CASE",
    async () => {
      const workdir = await setupProject();
      try {
        let r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Workout Tracker",
          "--actions",
          JSON.stringify([
            { type: "ADD_MODULE", input: { id: "workouts", name: "Workouts" } },
          ]),
        );
        expect(r.code).toBe(0);

        r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Workout Tracker",
          "--actions",
          JSON.stringify([
            {
              type: "ADD_OPERATION",
              input: {
                moduleId: "workouts",
                id: "addWorkout",
                name: "ADD_WORKOUT",
                schema: "input AddWorkoutInput { id: String! }",
              },
            },
          ]),
        );
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/Applied 1 action/);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );
});
