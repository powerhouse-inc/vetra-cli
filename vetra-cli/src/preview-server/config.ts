/**
 * Preview-server configuration.
 *
 * The server runs alongside the vetra-cli daemon and gives the embedded
 * vetra-studio editor a way to resolve, on each render, the live URL of the
 * currently previewed reactor-project document — and to start the project if
 * it isn't running yet. The port stays fixed by default so the browser side
 * can hardcode the base URL.
 */
export const DEFAULT_PREVIEW_SERVER_PORT = 5180;

export const PREVIEW_SERVER_HOST = "127.0.0.1";

export type ResolveResult =
  | { kind: "no-target" }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "project-stopped"; project: string; projectPath: string }
  | { kind: "starting"; project: string; projectPath: string; driveId: string }
  | { kind: "ready"; project: string; projectPath: string; driveId: string; documentId: string; url: string };

export type StartResult =
  | { kind: "started"; project: string; projectPath: string; instanceId: string; driveId: string }
  | { kind: "already-running"; project: string; projectPath: string; instanceId: string; driveId: string; status: "starting" | "ready" }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "failed"; project: string; error: string };

export type SseEvent = {
  type:
    | "service:starting"
    | "service:ready"
    | "service:stopped"
    | "service:restarting"
    | "service:failed";
  instanceId?: string;
  workdir?: string;
  driveId?: string;
  error?: string;
};
