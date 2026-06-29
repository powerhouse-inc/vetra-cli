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
 * Origin+prefix to resolve proxy-relative `proxiedUrl`s against. The proxied
 * stamp mounts the preview-server at a `/preview` SUFFIX, optionally under a
 * subpath (`https://host/myagent/preview` → `https://host/myagent`). A direct
 * stamp (or dev fallback) has no `/preview` suffix and serves from the loopback
 * root, where proxy paths don't exist — leave it undefined so the direct url
 * stands.
 */
const PROXY_BASE = (() => {
  try {
    const u = new URL(BASE);
    if (!u.pathname.endsWith("/preview")) return undefined;
    const prefix = u.pathname.slice(0, -"/preview".length);
    return u.origin + prefix;
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
  if (result.kind === "ready" && PROXY_BASE && result.proxiedUrl) {
    return { ...result, url: `${PROXY_BASE}${result.proxiedUrl}` };
  }
  return result;
}

export type ProjectPackageResult =
  | { kind: "ok"; project: string; name: string; version: string }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "no-package"; project: string; error: string };

/** Read a project's package identity (name + version) from its package.json. */
export async function fetchProjectPackage(args: {
  project: string;
  signal?: AbortSignal;
}): Promise<ProjectPackageResult> {
  const params = new URLSearchParams({ project: args.project });
  const res = await fetch(`${BASE}/project-package?${params}`, {
    signal: args.signal,
  });
  if (!res.ok) {
    throw new Error(
      `preview-server /project-package: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as ProjectPackageResult;
}

export type ReleaseStatusResult =
  | {
      kind: "ok";
      project: string;
      packageName: string;
      localVersion: string | null;
      publishedVersion: string | null;
      upToDate: boolean;
      needsRelease: boolean;
      reason: string;
    }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "no-package"; project: string; error: string }
  | { kind: "unknown"; project: string; error: string };

/** Whether a project's current source is already published (up to date) or
 * needs a new release, by comparing its content hash to the registry. */
export async function fetchReleaseStatus(args: {
  project: string;
  signal?: AbortSignal;
}): Promise<ReleaseStatusResult> {
  const params = new URLSearchParams({ project: args.project });
  const res = await fetch(`${BASE}/release-status?${params}`, {
    signal: args.signal,
  });
  if (!res.ok) {
    throw new Error(
      `preview-server /release-status: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as ReleaseStatusResult;
}

export type PublishProjectResult =
  | {
      kind: "ok";
      project: string;
      packageName: string;
      version: string;
      registry: string;
      published: boolean;
    }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "no-package"; project: string; error: string }
  | { kind: "auth-required"; project: string; error: string }
  | { kind: "failed"; project: string; error: string };

/** Build + publish a project's package to the registry (skipped server-side
 * when the source is already the latest published version). Returns the
 * published name + version to install into an environment. All outcomes carry a
 * discriminated body, so this doesn't throw on non-2xx. */
export async function publishProject(args: {
  project: string;
  signal?: AbortSignal;
}): Promise<PublishProjectResult> {
  const params = new URLSearchParams({ project: args.project });
  const res = await fetch(`${BASE}/publish?${params}`, {
    method: "POST",
    signal: args.signal,
  });
  return (await res.json()) as PublishProjectResult;
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

/** Running versions of the vetra-cli daemon serving this studio. */
export type VersionInfo = { vetraCli: string; ph: string };

/** Fetch the daemon's vetra-cli + ph versions (served from /version). */
export async function fetchVersion(signal?: AbortSignal): Promise<VersionInfo> {
  const res = await fetch(`${BASE}/version`, { signal });
  if (!res.ok) {
    throw new Error(`preview-server /version: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as VersionInfo;
}

/** Renown auth state served by the daemon's /auth endpoints. `pending`
 * is set while a Renown console login is awaiting browser approval. */
export type AuthState = {
  authenticated: boolean;
  address?: string;
  pending?: { loginUrl: string };
};

/** Current Renown auth state (read-only; does not advance the login). */
export async function fetchAuthStatus(
  signal?: AbortSignal,
): Promise<AuthState> {
  const res = await fetch(`${BASE}/auth/status`, { signal });
  if (!res.ok) {
    throw new Error(
      `preview-server /auth/status: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as AuthState;
}

/** Start a login for the agent's identity: the daemon builds the renown.id
 * console URL (returned as `pending.loginUrl`) and stashes the session. */
export async function startAuth(signal?: AbortSignal): Promise<AuthState> {
  const res = await fetch(`${BASE}/auth/start`, {
    method: "POST",
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `preview-server /auth/start: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as AuthState;
}

/** Advance a pending login: the daemon polls Renown for up to `waitMs` and,
 * once the user has approved in the browser, stores the credential. */
export async function confirmAuth(args?: {
  waitMs?: number;
  signal?: AbortSignal;
}): Promise<AuthState> {
  const params = new URLSearchParams();
  if (args?.waitMs != null) params.set("wait", String(args.waitMs));
  const qs = params.toString();
  const res = await fetch(`${BASE}/auth/confirm${qs ? `?${qs}` : ""}`, {
    method: "POST",
    signal: args?.signal,
  });
  if (!res.ok) {
    throw new Error(
      `preview-server /auth/confirm: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as AuthState;
}

/** Clear the stored credential (the agent's keypair/DID is kept). */
export async function logoutAuth(signal?: AbortSignal): Promise<AuthState> {
  const res = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `preview-server /auth/logout: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as AuthState;
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
