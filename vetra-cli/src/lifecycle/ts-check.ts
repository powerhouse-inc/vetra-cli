/**
 * Lints and type-checks TypeScript files the agent writes through its
 * workspace tools, surfacing problems as a blocking tool error so the agent
 * fixes them before moving on.
 *
 * After `mastra_workspace_write_file` / `mastra_workspace_edit_file` writes a
 * `.ts`/`.tsx` file, this hook:
 *   1. runs `eslint --fix` on the file (auto-corrects formatting/fixable lint),
 *   2. runs the project's `tsc --noEmit` and keeps only diagnostics for the
 *      edited file (the whole-project run reports pre-existing errors in
 *      unrelated files; those are not this edit's concern),
 *   3. throws with the combined remaining diagnostics if any are left.
 *
 * The write itself always succeeds first — the throw is feedback, not a
 * rollback. eslint/tsc are resolved from the edited file's own project
 * (`node_modules/.bin`); if a project has neither, the file is left alone.
 * Infra failures (missing binary, eslint/tsc crash) are logged and ignored —
 * only real lint/type diagnostics block the agent.
 *
 * Hook point mirrors `gen-guard`: a `tool` wrap recognising the two writing
 * workspace tools by name. Paths arrive workspace-relative, so they're
 * resolved against the workdir (mirroring ph-clint's
 * `resolveWorkdir({ fallback: process.cwd() })`).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { LifecycleHook } from "@powerhousedao/ph-clint";
import { extractPath, isCodegenPath } from "./gen-guard.js";

/** Minimal slice of ph-clint's Logger the hook uses (not re-exported). */
type LogLike = { warn?: (msg: string) => void };

const execFileAsync = promisify(execFile);

const WRITE_TOOLS = new Set([
  "mastra_workspace_write_file",
  "mastra_workspace_edit_file",
]);

/* Generous ceiling — a full-project tsc on a cold cache can take ~15s. */
const CHECK_TIMEOUT_MS = 120_000;

/** Mirror of ph-clint's resolveWorkdir: `-w/--workdir` resolved against cwd. */
function resolveWorkdirFromArgv(argv: string[]): string {
  const i = argv.findIndex((a) => a === "--workdir" || a === "-w");
  const raw = i >= 0 && argv[i + 1] ? argv[i + 1] : ".";
  return path.resolve(process.cwd(), raw);
}

/** Nearest ancestor directory (inclusive of `start`) containing `marker`. */
function findUp(start: string, marker: string): string | undefined {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Run a project-local binary, resolving exit code + combined output. */
async function runBin(
  bin: string,
  binArgs: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, binArgs, {
      cwd,
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

async function lintAndTypecheck(
  absFile: string,
  log: LogLike | undefined,
): Promise<string[]> {
  const problems: string[] = [];
  const fileDir = path.dirname(absFile);

  // eslint — resolved from the file's project; --fix first, report remainder.
  const eslintRoot = findUp(fileDir, "eslint.config.js");
  const eslintBin = eslintRoot
    ? path.join(eslintRoot, "node_modules", ".bin", "eslint")
    : undefined;
  if (eslintBin && existsSync(eslintBin)) {
    const { code, output } = await runBin(
      eslintBin,
      ["--fix", "--cache", absFile],
      eslintRoot!,
    );
    // eslint: 0 clean, 1 lint errors remain, 2 = eslint itself failed.
    if (code === 1 && output.trim()) {
      problems.push(`eslint:\n${output.trim()}`);
    } else if (code > 1) {
      log?.warn?.(`[ts-check] eslint failed to run on ${absFile}: ${output.trim()}`);
    }
  }

  // tsc — whole-project --noEmit, keep only this file's diagnostics.
  const tscRoot = findUp(fileDir, "tsconfig.json");
  const tscBin = tscRoot
    ? path.join(tscRoot, "node_modules", ".bin", "tsc")
    : undefined;
  if (tscBin && existsSync(tscBin)) {
    const { output } = await runBin(
      tscBin,
      ["--noEmit", "--pretty", "false"],
      tscRoot!,
    );
    // tsc prints paths relative to its cwd (the project root).
    const relFromProject = path.relative(tscRoot!, absFile).replace(/\\/g, "/");
    const lines = output
      .split("\n")
      .filter((l) => l.replace(/\\/g, "/").startsWith(relFromProject));
    if (lines.length) {
      problems.push(`tsc:\n${lines.join("\n")}`);
    }
  }

  return problems;
}

export function tsCheck(): LifecycleHook {
  return {
    name: "ts-check",
    onInit(ctx) {
      const workdir = resolveWorkdirFromArgv(process.argv);
      return {
        contribute: {
          tool(name, tool) {
            if (!WRITE_TOOLS.has(name)) return tool;
            const innerExecute = tool.execute.bind(tool);
            return {
              ...tool,
              // Mastra calls execute(args, toolContext) — forward every arg.
              execute: async (...args: unknown[]) => {
                const result = await innerExecute(...args);

                const rel = extractPath(args[0]);
                if (!rel || !/\.tsx?$/.test(rel) || isCodegenPath(rel)) {
                  return result;
                }
                const absFile = path.resolve(workdir, rel);
                if (!existsSync(absFile)) return result;

                let problems: string[];
                try {
                  problems = await lintAndTypecheck(absFile, ctx.log);
                } catch (err) {
                  ctx.log?.warn(`[ts-check] check errored for ${absFile}: ${String(err)}`);
                  return result;
                }
                if (problems.length) {
                  throw new Error(
                    `${name}: \`${rel}\` was written but has unresolved ` +
                      `lint/type problems (auto-fixable formatting was already ` +
                      `applied). Fix these, then re-edit:\n\n` +
                      problems.join("\n\n"),
                  );
                }
                return result;
              },
            };
          },
        },
      };
    },
  };
}
