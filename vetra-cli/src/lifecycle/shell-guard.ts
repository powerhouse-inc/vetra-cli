/**
 * Keeps the agent's workspace shell to installs.
 *
 * Tests, typecheck, lint and builds must run through `reactor-project-check`
 * (`tests: true`) or `reactor-project-build`: those runs are recorded as check
 * runs on the product's change, which is what the Tests gate reads. A vitest
 * run in the shell leaves no record. Commits and pushes belong to the launch,
 * which saves the code itself. So `mastra_workspace_execute_command` refuses
 * a command when any part of it (`a && b`, `a; b`, `a | b`, `sh -c "…"`)
 * starts one of those programs; installs (`pnpm add/install`, `npm install`)
 * and everything else still run. Not caught: programs started inside command
 * substitution (`$(…)`, backticks) or from a script file.
 *
 * Same hook point as gen-guard: a `tool` wrap on the workspace tool.
 */
import type { LifecycleHook } from "@powerhousedao/ph-clint";

const SHELL_TOOL = "mastra_workspace_execute_command";

export const CHECKS_REFUSAL =
  "Refused: run tests, typecheck, lint and builds with `reactor-project-check` " +
  "(`tests: true`) or `reactor-project-build`; the shell is for installs only.";
export const GIT_REFUSAL =
  "Refused: the code is saved with each launch; don't commit or push from the shell.";
export const MERGE_REFUSAL =
  "Refused: the launch completes the merge from GitHub (resolve and git add the files); don't continue, abort or quit it from the shell.";

/** Programs that are test/typecheck/lint runners wherever they appear. */
const RUNNERS = new Set(["vitest", "jest", "tsc", "eslint", "oxlint"]);
/** Package-manager scripts that run checks or builds. */
const PM_SCRIPTS = new Set(["test", "t", "lint", "typecheck", "build", "tsc", "vitest", "jest", "eslint"]);
/** Package-manager flags that take a value (`--filter vetra test`). */
const PM_VALUE_FLAGS = new Set(["--filter", "-F", "-C", "--dir", "--prefix", "--workspace"]);
/** Wrappers whose next word is the real program. */
const WRAPPERS = new Set(["npx", "bunx", "env", "time", "nice", "nohup", "sudo"]);

function unquote(word: string): string {
  return word.replace(/^['"]|['"]$/g, "");
}

function program(word: string | undefined): string {
  return (word ?? "").split("/").pop() ?? "";
}

/** The first non-flag word after `start`, skipping flags that take a value. */
function firstArg(words: string[], start: number): { word: string; at: number } | null {
  for (let i = start; i < words.length; i++) {
    const w = words[i];
    if (PM_VALUE_FLAGS.has(w)) {
      i++;
      continue;
    }
    if (w.startsWith("-")) continue;
    return { word: w, at: i };
  }
  return null;
}

/** Why one simple command (no `&&`/`;`/`|`) is refused, or null. */
function refuseSimple(segment: string): string | null {
  let words = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
  // Leading `VAR=value` assignments and wrappers.
  while (words.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || WRAPPERS.has(program(words[0])))) {
    words = words.slice(1);
    while (words[0]?.startsWith("-")) words = words.slice(1);
  }
  const prog = program(words[0]);
  if (!prog) return null;
  if (prog === "sh" || prog === "bash" || prog === "zsh") {
    // `-c`, `-lc`, `-ec`, …: any short-flag cluster containing `c`.
    const flag = words.find((w) => /^-[a-z]*c[a-z]*$/.test(w));
    if (flag) {
      const at = segment.indexOf(` ${flag}`) + flag.length + 1;
      return refuseCommand(unquote(segment.slice(at).trim()));
    }
    return null;
  }
  // `node node_modules/.bin/vitest …` runs the runner directly.
  if (prog === "node" && RUNNERS.has(program(firstArg(words, 1)?.word))) return CHECKS_REFUSAL;
  if (RUNNERS.has(prog)) return CHECKS_REFUSAL;
  if (prog === "pnpm" || prog === "yarn" || prog === "bun") {
    const arg = firstArg(words, 1);
    if (!arg) return null;
    if (arg.word === "exec" || arg.word === "dlx" || arg.word === "x") {
      return RUNNERS.has(program(firstArg(words, arg.at + 1)?.word)) ? CHECKS_REFUSAL : null;
    }
    const script = arg.word === "run" ? firstArg(words, arg.at + 1)?.word : arg.word;
    return script && (PM_SCRIPTS.has(script) || RUNNERS.has(script)) ? CHECKS_REFUSAL : null;
  }
  if (prog === "npm") {
    const arg = firstArg(words, 1)?.word;
    return arg === "test" || arg === "t" || arg === "run" || arg === "run-script" ? CHECKS_REFUSAL : null;
  }
  if (prog === "git") {
    const arg = firstArg(words, 1)?.word;
    if (arg === "commit" || arg === "push") return GIT_REFUSAL;
    // Finishing or dropping a Bring them in merge is the launch's (and Discard's) job.
    if (arg === "merge" && words.some((w) => w === "--continue" || w === "--abort" || w === "--quit")) {
      return MERGE_REFUSAL;
    }
    return null;
  }
  return null;
}

/** Why the shell command is refused, or null when it may run. */
export function refuseCommand(command: string): string | null {
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const reason = refuseSimple(segment);
    if (reason) return reason;
  }
  return null;
}

/** The `command` of an execute_command call (flat or createTool-style args). */
export function extractCommand(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const o = args as { command?: unknown; context?: unknown };
  if (typeof o.command === "string") return o.command;
  if (typeof o.context === "object" && o.context !== null) {
    const c = (o.context as { command?: unknown }).command;
    if (typeof c === "string") return c;
  }
  return undefined;
}

export function shellGuard(): LifecycleHook {
  return {
    name: "shell-guard",
    onInit() {
      return {
        contribute: {
          tool(name, tool) {
            if (name !== SHELL_TOOL) return tool;
            const innerExecute = tool.execute.bind(tool);
            return {
              ...tool,
              execute: (...args: unknown[]) => {
                const command = extractCommand(args[0]);
                const reason = command ? refuseCommand(command) : null;
                if (reason) throw new Error(reason);
                return innerExecute(...args);
              },
            };
          },
        },
      };
    },
  };
}
