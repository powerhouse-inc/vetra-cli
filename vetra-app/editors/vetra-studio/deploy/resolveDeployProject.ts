/**
 * Resolve a deploy follow-target to one of the drive's projects (pure,
 * unit-testable). A target names either the project directly (from
 * `reactor-project-publish --name`) or a package (from a
 * `deploy-environment-update --addPackage` install); the latter is matched
 * against each project's resolved package name.
 *
 * Returns `null` when it can't be resolved — the package data hasn't loaded
 * yet, or the package isn't one of this drive's projects (an external dep). The
 * watcher in `DeploySection` distinguishes "not yet" from "no match" via the
 * package-state status.
 */
import type { Project } from "../specify/projects.js";
import type { ProjectPackageInfo } from "./useProjectPackages.js";
import type { DeployTarget } from "../hooks/useSessionDeployTarget.js";

export function resolveDeployProject(
  target: DeployTarget,
  projects: readonly Project[],
  byProject: ReadonlyMap<string, ProjectPackageInfo | null> | undefined,
): Project | null {
  // A directly-named project (folder name == publish --name) wins.
  if (target.project) {
    const byName = projects.find((p) => p.name === target.project);
    if (byName) return byName;
  }
  // Otherwise map the installed package back to the project that produces it.
  if (target.packageName && byProject) {
    const match = projects.find(
      (p) => byProject.get(p.name)?.name === target.packageName,
    );
    if (match) return match;
  }
  return null;
}
