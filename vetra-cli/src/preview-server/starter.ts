/**
 * `POST /start` — idempotently bring a reactor-project online.
 *
 * Side-effecty. Triggered by the browser on `project-stopped`; can also be
 * called by the agent (the auto-injected `reactor-project-start` command is
 * equivalent). When an instance for this `workdir` is already `starting` or
 * `ready`, we return the existing instance without spawning a second one.
 */
import type { ServiceManager } from "@powerhousedao/ph-clint";
import { resolveReactorProjectPath } from "../helpers/project.js";
import { getPreviewDriveId } from "../helpers/reactor-project-preview.js";
import type { StartResult } from "./config.js";

export async function startPreview(args: {
  services: ServiceManager;
  workdir: string;
  project: string;
  /** Live public proxy origin; advertised as the base of the project's drive URLs. */
  proxyPublicUrl?: string;
}): Promise<StartResult> {
  let projectPath: string;
  try {
    projectPath = await resolveReactorProjectPath(args.workdir, args.project);
  } catch (err) {
    return {
      kind: "unknown-project",
      project: args.project,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const driveId = getPreviewDriveId(projectPath);
  const existing = args.services
    .list("reactor-project")
    .find(
      (i) =>
        i.workdir === projectPath &&
        (i.status === "ready" || i.status === "starting"),
    );
  if (existing) {
    return {
      kind: "already-running",
      project: args.project,
      projectPath,
      instanceId: existing.instanceId ?? "",
      driveId,
      status: existing.status as "starting" | "ready",
    };
  }

  try {
    const instanceId = await args.services.start("reactor-project", {
      workdir: projectPath,
      cwd: projectPath,
      params: args.proxyPublicUrl
        ? { proxyPublicUrl: args.proxyPublicUrl }
        : undefined,
    });
    return {
      kind: "started",
      project: args.project,
      projectPath,
      instanceId,
      driveId,
    };
  } catch (err) {
    return {
      kind: "failed",
      project: args.project,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
