/**
 * Read a reactor-project's published package identity (name + version) from
 * its package.json. Powers the Deploy section's read-only package display.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveReactorProjectPath } from "../helpers/project.js";

export type ProjectPackageResult =
  | { kind: "ok"; project: string; name: string; version: string }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "no-package"; project: string; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function readProjectPackage(
  workdir: string,
  project: string,
): Promise<ProjectPackageResult> {
  if (!project) {
    return { kind: "unknown-project", project, error: "No project specified." };
  }
  let projectPath: string;
  try {
    projectPath = await resolveReactorProjectPath(workdir, project);
  } catch (err) {
    return { kind: "unknown-project", project, error: message(err) };
  }
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf-8");
    const json = JSON.parse(raw) as { name?: string; version?: string };
    if (!json.name) {
      return {
        kind: "no-package",
        project,
        error: `package.json in ${projectPath} has no "name" field.`,
      };
    }
    return {
      kind: "ok",
      project,
      name: json.name,
      version: json.version ?? "0.0.0",
    };
  } catch (err) {
    return { kind: "no-package", project, error: message(err) };
  }
}
