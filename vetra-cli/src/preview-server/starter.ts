/**
 * `POST /start` — idempotently bring a reactor-project online
 * (`POST /restart` stops it first, see `restartPreview`).
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
  // The browser always names the project; an empty one never picks the
  // workspace's only project.
  if (!args.project) {
    return { kind: "unknown-project", project: args.project, error: "No project specified." };
  }
  let projectPath: string;
  try {
    projectPath = await resolveReactorProjectPath(args.workdir, args.project, {
      soleProjectDefault: false,
    });
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

  return spawn(args, projectPath, driveId);
}

async function spawn(
  args: { services: ServiceManager; project: string; proxyPublicUrl?: string },
  projectPath: string,
  driveId: string,
): Promise<StartResult> {
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

/** Instance states a restart stops (one stuck `starting` included). */
const RUNNING = new Set(["starting", "ready"]);

/** Restarts in flight, per project path: overlapping calls share one. */
const restarts = new Map<string, Promise<StartResult>>();
/** Requests in flight, per workdir + project name (before the path is known). */
const requests = new Map<string, Promise<StartResult>>();

/**
 * `POST /restart` — stop the project's running preview instances (including
 * one stuck `starting`) and start a fresh one. Overlapping restarts of the
 * same project share a single restart.
 */
export function restartPreview(args: {
  services: ServiceManager;
  workdir: string;
  project: string;
  proxyPublicUrl?: string;
}): Promise<StartResult> {
  // Keyed before any await, so a second call can't slip past the first.
  const key = `${args.workdir}\0${args.project}`;
  const pending = requests.get(key);
  if (pending) return pending;
  const request = restartProject(args).finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}

async function restartProject(args: {
  services: ServiceManager;
  workdir: string;
  project: string;
  proxyPublicUrl?: string;
}): Promise<StartResult> {
  // The browser always names the project; an empty one never picks the
  // workspace's only project.
  if (!args.project) {
    return { kind: "unknown-project", project: args.project, error: "No project specified." };
  }
  let projectPath: string;
  try {
    projectPath = await resolveReactorProjectPath(args.workdir, args.project, {
      soleProjectDefault: false,
    });
  } catch (err) {
    return {
      kind: "unknown-project",
      project: args.project,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // The same project asked for under another name shares the restart too.
  const inFlight = restarts.get(projectPath);
  if (inFlight) return inFlight;
  const restart = stopThenSpawn(args, projectPath).finally(() => {
    restarts.delete(projectPath);
  });
  restarts.set(projectPath, restart);
  return restart;
}

async function stopThenSpawn(
  args: { services: ServiceManager; project: string; proxyPublicUrl?: string },
  projectPath: string,
): Promise<StartResult> {
  const running = (instanceId?: string) =>
    args.services
      .list("reactor-project")
      .filter(
        (i) =>
          i.workdir === projectPath &&
          RUNNING.has(i.status) &&
          (instanceId === undefined || i.instanceId === instanceId),
      );
  for (const instance of running()) {
    try {
      await args.services.stop("reactor-project", instance.instanceId);
    } catch (err) {
      // Already stopping or gone meanwhile: nothing left to stop.
      if (running(instance.instanceId).length === 0) continue;
      return {
        kind: "failed",
        project: args.project,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return spawn(args, projectPath, getPreviewDriveId(projectPath));
}
