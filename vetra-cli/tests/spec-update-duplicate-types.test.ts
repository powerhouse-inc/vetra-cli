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
  opts: { workdir?: string },
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
    child.stdin.end();
  });
}

/**
 * Sentry #917 regression: spec-update must reject a document model that defines
 * the same type/enum name in more than one place (global state, local state, or
 * an operation schema) with an agent-actionable error, before it is persisted —
 * and must still accept a model that merely *references* a type elsewhere.
 */
describe("spec-update — duplicate type/enum name validation (Sentry #917)", () => {
  const TIMEOUT = 60_000;

  async function setupProject(): Promise<string> {
    const workdir = mkdtempSync(join(tmpdir(), "vetra-dup-"));
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
    const r = await run(
      { workdir },
      "spec-create",
      "--type",
      "powerhouse/document-model",
      "--name",
      "Employment Details",
    );
    expect(r.code).toBe(0);
    return workdir;
  }

  it(
    "rejects an enum redefined in both global and local state",
    async () => {
      const workdir = await setupProject();
      try {
        // Global state defines the enum once — fine on its own.
        let r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Employment Details",
          "--actions",
          JSON.stringify([
            {
              type: "SET_STATE_SCHEMA",
              input: {
                scope: "global",
                schema:
                  "type EmploymentDetailsState { contractType: ContractType } enum ContractType { FULL_TIME PART_TIME }",
              },
            },
          ]),
        );
        expect(r.code).toBe(0);

        // Local state redefines the same enum name -> duplicate, must be rejected.
        r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Employment Details",
          "--actions",
          JSON.stringify([
            {
              type: "SET_STATE_SCHEMA",
              input: {
                scope: "local",
                schema: "enum ContractType { FULL_TIME PART_TIME }",
              },
            },
          ]),
        );
        expect(r.code).not.toBe(0);
        expect(r.stderr).toMatch(/[Dd]uplicate/);
        expect(r.stderr).toMatch(/ContractType/);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    "rejects an operation schema that redefines a state enum (the #917 trigger)",
    async () => {
      const workdir = await setupProject();
      try {
        let r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Employment Details",
          "--actions",
          JSON.stringify([
            {
              type: "SET_STATE_SCHEMA",
              input: {
                scope: "global",
                schema:
                  "type EmploymentDetailsState { contractType: ContractType } enum ContractType { FULL_TIME PART_TIME }",
              },
            },
            { type: "ADD_MODULE", input: { id: "contracts", name: "Contracts" } },
          ]),
        );
        expect(r.code).toBe(0);

        // Operation redefines ContractType (already in state) -> duplicate.
        r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Employment Details",
          "--actions",
          JSON.stringify([
            {
              type: "ADD_OPERATION",
              input: {
                moduleId: "contracts",
                id: "setContractType",
                name: "SET_CONTRACT_TYPE",
                schema:
                  "input SetContractTypeInput { contractType: ContractType } enum ContractType { FULL_TIME PART_TIME }",
              },
            },
          ]),
        );
        expect(r.code).not.toBe(0);
        expect(r.stderr).toMatch(/[Dd]uplicate/);
        expect(r.stderr).toMatch(/ContractType/);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    "accepts an operation schema that references (not redefines) a state enum",
    async () => {
      const workdir = await setupProject();
      try {
        let r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Employment Details",
          "--actions",
          JSON.stringify([
            {
              type: "SET_STATE_SCHEMA",
              input: {
                scope: "global",
                schema:
                  "type EmploymentDetailsState { contractType: ContractType } enum ContractType { FULL_TIME PART_TIME }",
              },
            },
            { type: "ADD_MODULE", input: { id: "contracts", name: "Contracts" } },
          ]),
        );
        expect(r.code).toBe(0);

        // Operation references ContractType but does not redefine it -> allowed.
        r = await run(
          { workdir },
          "spec-update",
          "--name",
          "Employment Details",
          "--actions",
          JSON.stringify([
            {
              type: "ADD_OPERATION",
              input: {
                moduleId: "contracts",
                id: "addContract",
                name: "ADD_CONTRACT",
                schema: "input AddContractInput { contractType: ContractType }",
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
