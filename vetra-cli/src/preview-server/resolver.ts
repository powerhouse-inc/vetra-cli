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
import {
  buildPreviewDocPath,
  buildPreviewDriveRootPath,
  driveRemoteUrl,
  getPreviewDriveId,
} from "../helpers/reactor-project-preview.js";
import type { ResolveResult } from "./config.js";

export async function resolvePreview(args: {
  services: ServiceManager;
  workdir: string;
  project: string;
  doc: string;
  drive?: string;
}): Promise<ResolveResult> {
  if (!args.project) return { kind: "no-target" };
  if (!args.drive && !args.doc) return { kind: "no-target" };

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

  const defaultDriveId = getPreviewDriveId(projectPath);
  const targetDriveId = args.drive ?? defaultDriveId;
  const instance = args.services
    .list("reactor-project")
    .find((i) => i.workdir === projectPath);

  if (!instance) {
    return { kind: "project-stopped", project: args.project, projectPath };
  }
  if (instance.status === "starting") {
    return { kind: "starting", project: args.project, projectPath, driveId: targetDriveId };
  }
  if (instance.status !== "ready") {
    return { kind: "project-stopped", project: args.project, projectPath };
  }

  const connectUrl = instance.endpoints?.["vetra-studio"];
  if (!connectUrl) {
    return { kind: "starting", project: args.project, projectPath, driveId: targetDriveId };
  }

  const base = connectUrl.replace(/\/+$/, "");

  if (args.drive) {
    // Append the drive's remote URL so Connect registers the ad-hoc app drive
    // via addRemoteDrive on load; otherwise it bounces to the drive picker.
    const switchboardUrl = instance.endpoints?.["vetra-switchboard"];
    const docPath = buildPreviewDriveRootPath(
      args.drive,
      switchboardUrl ? driveRemoteUrl(switchboardUrl, args.drive) : undefined,
    );
    return {
      kind: "ready",
      project: args.project,
      projectPath,
      driveId: args.drive,
      documentId: args.drive,
      url: `${base}${docPath}`,
      proxiedUrl: `${REACTOR_PROJECT_CONNECT_PROXY_PATH}${docPath}`,
    };
  }

  const docPath = buildPreviewDocPath(defaultDriveId, args.doc);
  return {
    kind: "ready",
    project: args.project,
    projectPath,
    driveId: defaultDriveId,
    documentId: args.doc,
    url: `${base}${docPath}`,
    proxiedUrl: `${REACTOR_PROJECT_CONNECT_PROXY_PATH}${docPath}`,
  };
}
