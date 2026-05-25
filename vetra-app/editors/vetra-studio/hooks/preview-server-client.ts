/**
 * Client-side bindings for the vetra-cli preview-server.
 *
 * The server runs in the vetra-cli daemon (separate process from Connect)
 * on a fixed loopback port. We hardcode the URL — same convention as the
 * Switchboard / Connect endpoints that get baked into the bundle at build
 * time. If the port becomes configurable upstream, swap this for a value
 * read from `import.meta.env`.
 *
 * The EventSource is shared across all consumers of `usePreviewEvents` so
 * we keep exactly one open connection per browser tab regardless of how
 * many BUILD panes mount.
 */
export const PREVIEW_SERVER_BASE_URL = "http://127.0.0.1:5180";

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

export async function fetchResolve(args: {
  project: string;
  doc: string;
  signal?: AbortSignal;
}): Promise<ResolveResult> {
  const u = new URL(`${PREVIEW_SERVER_BASE_URL}/resolve`);
  u.searchParams.set("project", args.project);
  u.searchParams.set("doc", args.doc);
  const res = await fetch(u.toString(), { signal: args.signal });
  if (!res.ok) {
    throw new Error(`preview-server /resolve: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ResolveResult;
}

export async function fetchStart(args: {
  project: string;
  signal?: AbortSignal;
}): Promise<StartResult> {
  const u = new URL(`${PREVIEW_SERVER_BASE_URL}/start`);
  u.searchParams.set("project", args.project);
  const res = await fetch(u.toString(), { method: "POST", signal: args.signal });
  // 202/200/404/500 are all expected response codes; let caller branch on body.
  return (await res.json()) as StartResult;
}

type Listener = (eventType: string) => void;

let sharedSource: EventSource | undefined;
const listeners = new Set<Listener>();

function ensureSource(): EventSource | undefined {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return undefined;
  if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return sharedSource;
  const src = new EventSource(`${PREVIEW_SERVER_BASE_URL}/events`);
  for (const type of [
    "service:starting",
    "service:ready",
    "service:stopped",
    "service:restarting",
    "service:failed",
  ]) {
    src.addEventListener(type, () => {
      for (const fn of listeners) fn(type);
    });
  }
  sharedSource = src;
  return src;
}

/** Subscribe to preview-server events. Returns an unsubscribe function. */
export function subscribePreviewEvents(listener: Listener): () => void {
  ensureSource();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
