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

describe("vetra-cli spec-* (e2e)", () => {
  // E2E spawns tsx; bump the per-test timeout to absorb the warm-up.
  const TIMEOUT = 60_000;

  it(
    "--help lists all spec-* commands",
    async () => {
      const { stdout, code } = await run({}, "--help");
      expect(code).toBe(0);
      for (const cmd of [
        "spec-list",
        "spec-get",
        "spec-create",
        "spec-update",
        "spec-delete",
        "spec-extract",
        "spec-generate",
        "spec-schema-list",
        "spec-schema",
        "reactor-project-init",
        "reactor-project-build",
        "reactor-project-publish",
      ]) {
        expect(stdout).toContain(cmd);
      }
    },
    TIMEOUT,
  );

  it(
    "walks a full CRUD lifecycle in a temp workdir",
    async () => {
      const workdir = mkdtempSync(join(tmpdir(), "vetra-cli-e2e-"));
      writeFileSync(join(workdir, "powerhouse.config.json"), "{}\n");
      try {
        // list: empty
        let r = await run({ workdir }, "spec-list");
        expect(r.code).toBe(0);
        expect(r.stdout).toContain("(no specs)");

        // create
        r = await run(
          { workdir },
          "spec-create",
          "--type",
          "powerhouse/document-model",
          "--name",
          "E2E",
        );
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/Created/);

        // list: shows the new spec
        r = await run({ workdir }, "spec-list");
        expect(r.stdout).toContain("E2E");
        expect(r.stdout).toContain("powerhouse/document-model");

        // get with --filter projecting to a scalar (filter applies to state)
        r = await run(
          { workdir },
          "spec-get",
          "--name",
          "E2E",
          "--filter",
          "$.global.specifications[0].version",
        );
        expect(r.stdout.trim()).toBe("1");

        // update via piped stdin (no --from)
        r = await run(
          {
            workdir,
            input: '[{"type":"SET_MODEL_NAME","input":{"name":"Updated"}}]',
          },
          "spec-update",
          "--name",
          "E2E",
        );
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/Applied 1 action/);

        // verify the update landed
        r = await run(
          { workdir },
          "spec-get",
          "--name",
          "E2E",
          "--filter",
          "$.global.name",
        );
        expect(r.stdout.trim()).toBe("Updated");

        // delete
        r = await run({ workdir }, "spec-delete", "--name", "E2E");
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/Deleted "E2E"/);

        // list: empty again
        r = await run({ workdir }, "spec-list");
        expect(r.stdout).toContain("(no specs)");
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    "spec-schema --action returns the raw GraphQL for the named action",
    async () => {
      const { stdout, code } = await run(
        {},
        "spec-schema",
        "--type",
        "powerhouse/document-model",
        "--action",
        "SET_MODEL_NAME",
      );
      expect(code).toBe(0);
      expect(stdout).toMatch(/^input SetModelNameInput/);
      expect(stdout).toMatch(/name: String!/);
    },
    TIMEOUT,
  );

  it(
    "spec-schema rejects mutually-exclusive --action + --state",
    async () => {
      const { stderr, code } = await run(
        {},
        "spec-schema",
        "--type",
        "powerhouse/document-model",
        "--action",
        "SET_MODEL_NAME",
        "--state",
      );
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/mutually exclusive/);
    },
    TIMEOUT,
  );

  it(
    "required flag missing fails non-zero",
    async () => {
      const { code, stderr } = await run({}, "spec-get");
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/name/);
    },
    TIMEOUT,
  );
});
