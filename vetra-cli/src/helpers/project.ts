import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { formatLines } from "./cli-errors.js";
import { suggestNames } from "./suggestions.js";

export const projectInputSchema = z
  .string()
  .optional()
  .describe(
    "Project sub-directory under workdir to scope this command to. Omit to act on workdir itself.",
  );

/**
 * Resolve which directory a command should act on. Errors if the resolved
 * directory isn't a Reactor package (no powerhouse.config.json).
 *   - `subdir` set  → `<workdir>/<subdir>`
 *   - `subdir` unset → `workdir` itself
 *
 * The successful path is one stat (the config file). The expensive
 * `listReactorProjects` walk happens only when we're about to throw — so the
 * async syscalls are tolerable here.
 */
export async function resolveReactorProjectPath(
  workdir: string,
  subdir: string | undefined,
): Promise<string> {
  const base = subdir ? path.join(workdir, subdir) : workdir;
  if (subdir && !(await pathExists(base))) {
    throw new Error(
      formatLines(
        `Project directory "${subdir}" not found at ${base}.`,
        await availableProjectsHint(workdir, subdir, initHint(subdir)),
      ),
    );
  }
  if (!(await pathExists(path.join(base, "powerhouse.config.json")))) {
    throw new Error(
      formatLines(
        subdir
          ? `"${subdir}" is not a Reactor package (missing powerhouse.config.json at ${base}).`
          : `Workdir is not a Reactor package (missing powerhouse.config.json at ${base}).\nPass a project sub-directory name, or run from inside a Reactor package.`,
        await availableProjectsHint(workdir, subdir, initHint(subdir)),
      ),
    );
  }
  return base;
}

/**
 * Where a missing project comes from. On staging the agent read the bare "not
 * found" errors as "write the files by hand", and spec-create then accepted
 * its stub `powerhouse.config.json`.
 */
function initHint(name: string | undefined): string {
  return `Create a project with \`reactor-project-init { name: "${name ?? "<name>"}" }\` — never hand-write its files.`;
}

/**
 * Refuse a project `reactor-project-init` never set up: no `node_modules`
 * means no installed toolchain, so codegen would fetch `ph-cli` from the
 * public registry (and 404). Used by the spec commands that write into or
 * generate from a project.
 */
export async function assertProjectInstalled(base: string, subdir: string | undefined): Promise<void> {
  if (await pathExists(path.join(base, "node_modules"))) return;
  const label = subdir ? `"${subdir}"` : "The workdir";
  throw new Error(
    [
      `${label} is not an initialised project (no node_modules at ${base}).`,
      initHint(subdir),
      "reactor-project-init installs the project; it won't take over this directory, so init one under an unused name and use that.",
    ].join("\n"),
  );
}

/**
 * Resolve the base directory for a spec command. Product specs are
 * workspace-level ideation artifacts that exist before any reactor project:
 * when no project is named, the workdir isn't itself a reactor package, and
 * the command allows it, resolve to the workdir root instead of erroring.
 */
export async function resolveSpecBasePath(
  workdir: string,
  project: string | undefined,
  allowProductFallback: boolean,
): Promise<{ base: string; productFallback: boolean }> {
  const productFallback =
    allowProductFallback &&
    !project &&
    !(await pathExists(path.join(workdir, "powerhouse.config.json")));
  if (productFallback) return { base: workdir, productFallback };
  return {
    base: await resolveReactorProjectPath(workdir, project),
    productFallback: false,
  };
}

export async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

/**
 * List immediate sub-directories of `workdir` that are themselves Reactor
 * packages (have a `powerhouse.config.json`). Uses `withFileTypes` so a single
 * readdir replaces the per-entry stat that the prior version paid.
 */
export async function listReactorProjects(workdir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(workdir, { withFileTypes: true });
  } catch {
    return [];
  }
  const checks = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map(async (e) =>
      (await pathExists(path.join(workdir, e.name, "powerhouse.config.json")))
        ? e.name
        : null,
    );
  return (await Promise.all(checks))
    .filter((n): n is string => n !== null)
    .sort();
}

/** Existing projects (with a near-miss suggestion), then how to create one. */
async function availableProjectsHint(
  workdir: string,
  attempted: string | undefined,
  createHint: string,
): Promise<string> {
  const projects = await listReactorProjects(workdir);
  if (projects.length === 0) return createHint;
  const lines: string[] = [];
  if (attempted) {
    const suggestions = suggestNames(attempted, projects);
    if (suggestions.length > 0) {
      lines.push(`Did you mean: ${suggestions.join(", ")}?`);
    }
  }
  lines.push(`Available projects: ${projects.join(", ")}`, createHint);
  return lines.join("\n");
}
