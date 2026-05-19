import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

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
 */
export function resolveReactorProjectPath(
  workdir: string,
  subdir: string | undefined,
): string {
  const base = subdir ? path.join(workdir, subdir) : workdir;
  if (subdir && !existsSync(base)) {
    throw new Error(`Project directory "${subdir}" not found at ${base}.`);
  }
  if (!existsSync(path.join(base, "powerhouse.config.json"))) {
    throw new Error(
      subdir
        ? `"${subdir}" is not a Reactor package (missing powerhouse.config.json at ${base}).`
        : `Workdir is not a Reactor package (missing powerhouse.config.json at ${base}). Pass a project sub-directory name, or run from inside a Reactor package.`,
    );
  }
  return base;
}
