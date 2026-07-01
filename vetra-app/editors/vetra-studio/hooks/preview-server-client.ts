/**
 * Client-side bindings for the vetra-cli preview-server.
 *
 * The server runs in the vetra-cli daemon (separate process from Connect),
 * reached through the daemon's embedded proxy at `<proxy>/preview`. The
 * proxy URL isn't known at build time, so the daemon writes it into
 * `studio.config.json` (a sibling of `powerhouse.config.json`) on startup;
 * this module fetches that config once and caches it — no JS asset is mutated.
 * A missing config (vite dev, or before the first write) falls back to the
 * preview-server's direct loopback port.
 *
 * `ready` results carry a proxy-relative `proxiedUrl`; when the base is a
 * proxied `<proxy>/preview` URL we resolve it against the proxy origin so the
 * BUILD iframe goes through the proxy too.
 *
 * The EventSource is shared across all consumers of `subscribePreviewEvents`
 * so we keep exactly one open connection per browser tab regardless of how
 * many BUILD panes mount.
 */
const DIRECT_BASE = "http://127.0.0.1:5180";

// Vite dev serves the editor from source, where no daemon writes the config —
// use the direct port. Safe access: package builds may lack import.meta.env.
const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

interface PreviewConfig {
  // Absolute preview-server base (proxied `<proxy>/preview`, or a direct URL).
  base: string;
  // Origin+prefix to resolve proxy-relative `proxiedUrl`s against when the base
  // is a proxied `/preview` mount; undefined for a direct/loopback base.
  proxyBase?: string;
}

// Origin+prefix for a proxied `/preview` mount (`https://host/x/preview` ->
// `https://host/x`); undefined when the base isn't a `/preview` suffix.
function computeProxyBase(base: string): string | undefined {
  try {
    const u = new URL(base);
    if (!u.pathname.endsWith("/preview")) return undefined;
    return u.origin + u.pathname.slice(0, -"/preview".length);
  } catch {
    return undefined;
  }
}

// Base path the bundle is served under (daemon-substituted dynamic base, else
// the build-time base), to fetch sibling config from the bundle root.
function bundleBase(): string {
  const g = globalThis as { __PH_DYNAMIC_BASE__?: string };
  if (g.__PH_DYNAMIC_BASE__) return g.__PH_DYNAMIC_BASE__;
  return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
}

let configPromise: Promise<PreviewConfig> | undefined;

// Resolve (once, memoized) the preview-server base from studio.config.json.
function resolvePreviewConfig(): Promise<PreviewConfig> {
  configPromise ??= (async (): Promise<PreviewConfig> => {
    if (isDev) return { base: DIRECT_BASE };
    try {
      const res = await fetch(`${bundleBase()}studio.config.json`, {
        cache: "no-store",
      });
      if (res.ok) {
        const cfg = (await res.json()) as { previewServerUrl?: string };
        if (cfg.previewServerUrl) {
          return {
            base: cfg.previewServerUrl,
            proxyBase: computeProxyBase(cfg.previewServerUrl),
          };
        }
      }
    } catch {
      // fall through to the direct loopback base
    }
    return { base: DIRECT_BASE };
  })();
  return configPromise;
}

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
  const { base, proxyBase } = await resolvePreviewConfig();
  const res = await fetch(`${base}/resolve?${params}`, { signal: args.signal });
  if (!res.ok) {
    throw new Error(`preview-server /resolve: ${res.status} ${res.statusText}`);
  }
  const result = (await res.json()) as ResolveResult;
  if (result.kind === "ready" && proxyBase && result.proxiedUrl) {
    return { ...result, url: `${proxyBase}${result.proxiedUrl}` };
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/project-package?${params}`, {
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/release-status?${params}`, {
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/publish?${params}`, {
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/start?${params}`, {
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/version`, { signal });
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/auth/status`, { signal });
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/auth/start`, {
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/auth/confirm${qs ? `?${qs}` : ""}`, {
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
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/auth/logout`, {
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
let creatingSource = false;
const listeners = new Set<Listener>();

// Opens the shared EventSource once the config resolves. Guards against a
// concurrent open (the config fetch is async) and a closed prior source.
function ensureSource(): void {
  if (typeof window === "undefined" || typeof EventSource === "undefined")
    return;
  if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return;
  if (creatingSource) return;
  creatingSource = true;
  void resolvePreviewConfig().then(({ base }) => {
    creatingSource = false;
    if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return;
    const src = new EventSource(`${base}/events`);
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
  });
}

/** Subscribe to preview-server events. Returns an unsubscribe function. */
export function subscribePreviewEvents(listener: Listener): () => void {
  listeners.add(listener);
  ensureSource();
  return () => {
    listeners.delete(listener);
  };
}
