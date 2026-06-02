/**
 * `GET /resolve` — given the `project` label and `doc` id/slug a session
 * extracted from its chat history, return the live preview URL or a state
 * code the editor can render.
 *
 * Read-only. Never mutates ServiceManager state. The `/start` handler is the
 * sole mutator.
 */
import type { ServiceManager } from "@powerhousedao/ph-clint";
import { REACTOR_PROJECT_CONNECT_PROXY_PATH } from "../constants.js";
import { resolveReactorProjectPath } from "../helpers/project.js";
import { getPreviewDriveId } from "../helpers/reactor-project-preview.js";
import type { ResolveResult } from "./config.js";

export async function resolvePreview(args: {
  services: ServiceManager;
  workdir: string;
  project: string;
  doc: string;
}): Promise<ResolveResult> {
  if (!args.project || !args.doc) return { kind: "no-target" };

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
  const instance = args.services
    .list("reactor-project")
    .find((i) => i.workdir === projectPath);

  if (!instance) {
    return { kind: "project-stopped", project: args.project, projectPath };
  }
  if (instance.status === "starting") {
    return { kind: "starting", project: args.project, projectPath, driveId };
  }
  if (instance.status !== "ready") {
    return { kind: "project-stopped", project: args.project, projectPath };
  }

  const connectUrl = instance.endpoints?.["vetra-studio"];
  if (!connectUrl) {
    // Connect endpoint hasn't been captured yet — treat as still starting.
    return { kind: "starting", project: args.project, projectPath, driveId };
  }

  const base = connectUrl.replace(/\/+$/, "");
  const docPath = `/d/${driveId}/${encodeURIComponent(args.doc)}?embed=1`;
  return {
    kind: "ready",
    project: args.project,
    projectPath,
    driveId,
    documentId: args.doc,
    url: `${base}${docPath}`,
    proxiedUrl: `${REACTOR_PROJECT_CONNECT_PROXY_PATH}${docPath}`,
  };
}
