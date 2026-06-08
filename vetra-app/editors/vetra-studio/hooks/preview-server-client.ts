/**
 * Client-side bindings for the vetra-cli preview-server.
 *
 * The server runs in the vetra-cli daemon (separate process from Connect),
 * reached through the daemon's embedded proxy at `<proxy>/preview`. The
 * proxy URL isn't known at build time, so the base below is a placeholder
 * token (must match `PREVIEW_SERVER_URL_PLACEHOLDER` in vetra-cli's
 * `constants.ts`) that the `connect-drive-url` lifecycle hook stamps with
 * the absolute proxy URL on daemon startup — same mechanism as the default
 * drive URL. An unstamped bundle (vite dev, or before the first stamp)
 * falls back to the preview-server's direct loopback port.
 *
 * `ready` results carry a proxy-relative `proxiedUrl`; when the base is
 * stamped we resolve it against the proxy origin so the BUILD iframe goes
 * through the proxy too.
 *
 * The EventSource is shared across all consumers of `subscribePreviewEvents`
 * so we keep exactly one open connection per browser tab regardless of how
 * many BUILD panes mount.
 */
const PREVIEW_SERVER_BASE_URL = "http://__ph_preview_server_url__";
const DIRECT_BASE = "http://127.0.0.1:5180";

/* Vite dev serves the editor from source, where the placeholder is never
 * stamped — use the direct port there. Built bundles are stamped by the
 * daemon before the browser loads them (proxy URL when enabled, direct URL
 * otherwise). Safe access: package builds may lack import.meta.env. */
const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
const BASE = isDev ? DIRECT_BASE : PREVIEW_SERVER_BASE_URL;

/**
 * Proxy origin to resolve proxy-relative `proxiedUrl`s against. Only the
 * proxied stamp has the `/preview` path — a direct stamp (or dev fallback)
 * serves from the loopback root, where proxy paths don't exist.
 */
const PROXY_ORIGIN = (() => {
  try {
    const u = new URL(BASE);
    return u.pathname === "/preview" ? u.origin : undefined;
  } catch {
    return undefined;
  }
})();

export type ResolveResult =
  | { kind: "no-target" }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "project-stopped"; project: string; projectPath: string }
  | { kind: "starting"; project: string; projectPath: string; driveId: string }
  | {
      kind: "ready";
      project: string;
      projectPath: string;
      driveId: string;
      documentId: string;
      url: string;
      proxiedUrl?: string;
    };

export type StartResult =
  | {
      kind: "started";
      project: string;
      projectPath: string;
      instanceId: string;
      driveId: string;
    }
  | {
      kind: "already-running";
      project: string;
      projectPath: string;
      instanceId: string;
      driveId: string;
      status: "starting" | "ready";
    }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "failed"; project: string; error: string };

export async function fetchResolve(args: {
  project: string;
  doc: string;
  drive?: string;
  signal?: AbortSignal;
}): Promise<ResolveResult> {
  const params = new URLSearchParams({ project: args.project, doc: args.doc });
  if (args.drive) params.set("drive", args.drive);
  const res = await fetch(`${BASE}/resolve?${params}`, { signal: args.signal });
  if (!res.ok) {
    throw new Error(`preview-server /resolve: ${res.status} ${res.statusText}`);
  }
  const result = (await res.json()) as ResolveResult;
  if (result.kind === "ready" && PROXY_ORIGIN && result.proxiedUrl) {
    return { ...result, url: `${PROXY_ORIGIN}${result.proxiedUrl}` };
  }
  return result;
}

export async function fetchStart(args: {
  project: string;
  signal?: AbortSignal;
}): Promise<StartResult> {
  const params = new URLSearchParams({ project: args.project });
  const res = await fetch(`${BASE}/start?${params}`, {
    method: "POST",
    signal: args.signal,
  });
  // 202/200/404/500 are all expected response codes; let caller branch on body.
  return (await res.json()) as StartResult;
}

type Listener = (eventType: string) => void;

let sharedSource: EventSource | undefined;
const listeners = new Set<Listener>();

function ensureSource(): EventSource | undefined {
  if (typeof window === "undefined" || typeof EventSource === "undefined")
    return undefined;
  if (sharedSource && sharedSource.readyState !== EventSource.CLOSED)
    return sharedSource;
  const src = new EventSource(`${BASE}/events`);
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
