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
        await availableProjectsHint(workdir, subdir),
      ),
    );
  }
  if (!(await pathExists(path.join(base, "powerhouse.config.json")))) {
    throw new Error(
      formatLines(
        subdir
          ? `"${subdir}" is not a Reactor package (missing powerhouse.config.json at ${base}).`
          : `Workdir is not a Reactor package (missing powerhouse.config.json at ${base}).\nPass a project sub-directory name, or run from inside a Reactor package.`,
        await availableProjectsHint(workdir, subdir),
      ),
    );
  }
  return base;
}

async function pathExists(p: string): Promise<boolean> {
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
async function listReactorProjects(workdir: string): Promise<string[]> {
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

async function availableProjectsHint(
  workdir: string,
  attempted: string | undefined,
): Promise<string | undefined> {
  const projects = await listReactorProjects(workdir);
  if (projects.length === 0) return undefined;
  const lines: string[] = [];
  if (attempted) {
    const suggestions = suggestNames(attempted, projects);
    if (suggestions.length > 0) {
      lines.push(`Did you mean: ${suggestions.join(", ")}?`);
    }
  }
  lines.push(`Available projects: ${projects.join(", ")}`);
  return lines.join("\n");
}
