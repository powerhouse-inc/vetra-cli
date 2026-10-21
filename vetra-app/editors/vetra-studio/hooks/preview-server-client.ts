/**
 * Client-side bindings for the vetra preview-server.
 *
 * The server runs in the vetra daemon (separate process from Connect),
 * reached through the daemon's embedded proxy at `<proxy>/preview`. The
 * proxy URL isn't known at build time, so the daemon writes it into
 * `studio.config.json` (a sibling of `powerhouse.config.json`) on startup;
 * this module fetches that config and caches it once read (a failed fetch is
 * retried on the next call) — no JS asset is mutated.
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
 *
 * Owner-only routes (everything but /healthz, /version, /resolve, /events and
 * /export/status) carry the signed-in user's Renown bearer, minted for this
 * Studio only: `aud` = the Studio's public origin, so a token is worthless at
 * any other Studio (or the switchboard, which refuses `aud` tokens). The daemon
 * checks the wallet against the Studio's owner (ADMINS); without it, 401.
 * No bearer is sent until studio.config.json has named the Studio's origin
 * (never to the 127.0.0.1 fallback).
 */
const DIRECT_BASE = "http://127.0.0.1:5180";

/** Mints the signed-in user's Renown bearer bound to `aud`; undefined/null
 *  when signed out. */
export type PreviewAuthTokenProvider = (
  aud: string,
) => Promise<string | null | undefined>;

type RenownTokenSource = {
  user?: { address?: string } | null;
  getBearerToken: (opts: { expiresIn: number; aud: string }) => Promise<string>;
};

const TOKEN_TTL_S = 600;
/** Re-mint this long before expiry, so a token never lapses mid-request. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
let cachedToken:
  { address: string; aud: string; token: string; until: number } | undefined;

// The Connect Renown session (window.ph.renown), with a Studio-bound `aud`.
// One token is reused until near expiry (not minted per call); a sign-out or
// a different wallet drops it.
const ambientStudioToken: PreviewAuthTokenProvider = async (aud) => {
  if (typeof window === "undefined") return undefined;
  const renown = (window as unknown as { ph?: { renown?: RenownTokenSource } })
    .ph?.renown;
  const address = renown?.user?.address;
  if (!renown || !address || typeof renown.getBearerToken !== "function") {
    cachedToken = undefined;
    return undefined;
  }
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.address === address &&
    cachedToken.aud === aud &&
    cachedToken.until > now
  ) {
    return cachedToken.token;
  }
  const token = await renown.getBearerToken({ expiresIn: TOKEN_TTL_S, aud });
  cachedToken = {
    address,
    aud,
    token,
    until: now + TOKEN_TTL_S * 1000 - TOKEN_REFRESH_MARGIN_MS,
  };
  return token;
};

let tokenProvider: PreviewAuthTokenProvider = ambientStudioToken;

/** Override where owner-route bearers come from (tests); null restores the
 *  ambient Connect Renown session. */
export function setPreviewAuthTokenProvider(
  provider: PreviewAuthTokenProvider | null,
): void {
  tokenProvider = provider ?? ambientStudioToken;
}

/** `Authorization` for an owner-only route; empty when signed out or when the
 *  Studio's origin is unknown (the daemon then answers 401, which callers
 *  surface). */
async function ownerHeaders(): Promise<Record<string, string>> {
  try {
    const config = await resolvePreviewConfig();
    if (!config.loaded || config.base === DIRECT_BASE) return {};
    const aud = new URL(config.base).origin;
    const token = await tokenProvider(aud);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Shown when the daemon refuses an owner-only call (401/403). */
export const OWNER_REQUIRED = "Sign in as the Studio owner to do this.";

function isRefused(status: number): boolean {
  return status === 401 || status === 403;
}

// Vite dev serves the editor from source, where no daemon writes the config —
// use the direct port. Safe access: package builds may lack import.meta.env.
let devOverride: boolean | undefined;
const isDev = () =>
  devOverride ?? (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

/** Tests only: force the vite-dev (direct port) path on or off. */
export function setPreviewDevModeForTests(dev: boolean | undefined): void {
  devOverride = dev;
}

interface PreviewConfig {
  // Absolute preview-server base (proxied `<proxy>/preview`, or a direct URL).
  base: string;
  // Origin+prefix to resolve proxy-relative `proxiedUrl`s against when the base
  // is a proxied `/preview` mount; undefined for a direct/loopback base.
  proxyBase?: string;
  // The studio's cloud environment document id, when the daemon stamped one.
  environmentId?: string;
  // Registry to stamp onto envs this studio deploys; undefined outside a
  // provisioned studio (falls back to the shared client default).
  packageRegistryUrl?: string;
  // Cloud switchboard the Deploy view talks to; undefined outside a
  // provisioned studio (falls back to the shared client default).
  cloudSwitchboardUrl?: string;
  // False when studio.config.json could not be fetched or read: what it would
  // have said (e.g. the environment id) is unknown, not absent.
  loaded: boolean;
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

/** `load` memoized once it resolves with `loaded: true`; a result that
 *  didn't load is not kept, so the next call loads again. Calls made while
 *  a load is running share it. */
export function memoizeUntilLoaded<T extends { loaded: boolean }>(
  load: () => Promise<T>,
): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().then((value) => {
      if (!value.loaded) pending = undefined;
      return value;
    });
    return pending;
  };
}

// Resolve (memoized once it loads) the preview-server base from
// studio.config.json. A failed fetch is not kept: the next call tries again.
const resolvePreviewConfig = memoizeUntilLoaded(loadPreviewConfig);

async function loadPreviewConfig(): Promise<PreviewConfig> {
  if (isDev()) return { base: DIRECT_BASE, loaded: true };
  try {
    const res = await fetch(`${bundleBase()}studio.config.json`, {
      cache: "no-store",
    });
    if (res.ok) {
      const cfg = (await res.json()) as {
        previewServerUrl?: string;
        environmentId?: string;
        packageRegistryUrl?: string;
        cloudSwitchboardUrl?: string;
      };
      if (cfg.previewServerUrl) {
        return {
          base: cfg.previewServerUrl,
          proxyBase: computeProxyBase(cfg.previewServerUrl),
          environmentId: cfg.environmentId,
          packageRegistryUrl: cfg.packageRegistryUrl,
          cloudSwitchboardUrl: cfg.cloudSwitchboardUrl,
          loaded: true,
        };
      }
      return {
        base: DIRECT_BASE,
        environmentId: cfg.environmentId,
        loaded: true,
      };
    }
  } catch {
    // fall through to the direct loopback base
  }
  return { base: DIRECT_BASE, loaded: false };
}

/** Whether studio.config.json was read, and the Studio's own cloud id in it. */
export async function resolveStudioConfigLoad(): Promise<{
  loaded: boolean;
  environmentId: string | null;
}> {
  const config = await resolvePreviewConfig();
  return {
    loaded: config.loaded,
    environmentId: config.environmentId ?? null,
  };
}

/** The studio's cloud environment document id from `studio.config.json`, or
 * null when running outside a provisioned studio (e.g. vite dev). */
export async function resolveStudioEnvironmentId(): Promise<string | null> {
  const config = await resolvePreviewConfig();
  return config.environmentId ?? null;
}

/** The registry to stamp onto envs this studio deploys, from
 * `studio.config.json`; null outside a provisioned studio. */
export async function resolveStudioPackageRegistry(): Promise<string | null> {
  const config = await resolvePreviewConfig();
  return config.packageRegistryUrl ?? null;
}

/** The cloud switchboard this studio's Deploy view talks to, from
 * `studio.config.json`; null outside a provisioned studio. */
export async function resolveStudioCloudSwitchboardUrl(): Promise<
  string | null
> {
  const config = await resolvePreviewConfig();
  return config.cloudSwitchboardUrl ?? null;
}

export type ResolveResult =
  | { kind: "no-target" }
  | { kind: "unknown-project"; project: string; error: string }
  | { kind: "project-stopped"; project: string }
  | { kind: "starting"; project: string; driveId: string }
  | {
      kind: "ready";
      project: string;
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
  /** The project's preview drive root (no doc, no drive). */
  home?: boolean;
  signal?: AbortSignal;
}): Promise<ResolveResult> {
  const params = new URLSearchParams({ project: args.project, doc: args.doc });
  if (args.drive) params.set("drive", args.drive);
  if (args.home) params.set("home", "1");
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
    headers: await ownerHeaders(),
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
    headers: await ownerHeaders(),
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
    headers: await ownerHeaders(),
    signal: args.signal,
  });
  const body = (await res.json().catch(() => null)) as
    (PublishProjectResult & { kind?: string }) | null;
  // The owner gate answers without a result `kind`.
  if (!body?.kind) {
    return {
      kind: "failed",
      project: args.project,
      error: isRefused(res.status)
        ? OWNER_REQUIRED
        : `preview-server /publish: ${res.status} ${res.statusText}`,
    };
  }
  return body;
}

export async function fetchStart(args: {
  project: string;
  signal?: AbortSignal;
}): Promise<StartResult> {
  const params = new URLSearchParams({ project: args.project });
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/start?${params}`, {
    method: "POST",
    headers: await ownerHeaders(),
    signal: args.signal,
  });
  // 202/200/404/500 are all expected response codes; let caller branch on body.
  const body = (await res.json().catch(() => null)) as
    (StartResult & { kind?: string }) | null;
  if (!body?.kind) {
    return {
      kind: "failed",
      project: args.project,
      error: isRefused(res.status)
        ? OWNER_REQUIRED
        : `preview-server /start: ${res.status} ${res.statusText}`,
    };
  }
  return body;
}

export const RESTART_REFUSED = "Couldn't restart the preview.";

/**
 * Stops the project's preview and starts it again (works when it is stuck
 * starting). Returns null when the Studio's preview server has no
 * `/restart` (older Studios), so the caller can fall back to `/start`.
 * Throws `Couldn't restart the preview.` when the caller isn't allowed.
 */
export async function fetchRestart(args: {
  project: string;
  signal?: AbortSignal;
}): Promise<StartResult | null> {
  const params = new URLSearchParams({ project: args.project });
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/restart?${params}`, {
    method: "POST",
    headers: await ownerHeaders(),
    signal: args.signal,
  });
  // Owner-only: the daemon checks the caller's Renown bearer against the
  // Studio's owner. Not allowed: no fallback.
  if (isRefused(res.status)) throw new Error(RESTART_REFUSED);
  const body = (await res.json().catch(() => null)) as
    (StartResult & { kind?: string }) | null;
  // An unknown route answers 404 without a result `kind`.
  if (res.status === 404 && !body?.kind) return null;
  if (!body?.kind) {
    throw new Error(`preview-server /restart: ${res.status} ${res.statusText}`);
  }
  return body;
}

/** Running versions of the vetra daemon serving this studio. */
export type VersionInfo = { vetraCli: string; ph: string };

/** Fetch the daemon's vetra + ph versions (served from /version). */
export async function fetchVersion(signal?: AbortSignal): Promise<VersionInfo> {
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/version`, { signal });
  if (!res.ok) {
    throw new Error(`preview-server /version: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as VersionInfo;
}

/** Fetch the workspace export zip (owner-only). The caller checks the
 * status so a 401/409 surfaces a message instead of navigating. */
export async function fetchWorkspaceExport(
  signal?: AbortSignal,
): Promise<Response> {
  const { base } = await resolvePreviewConfig();
  return fetch(`${base}/export?workspace=1`, {
    headers: await ownerHeaders(),
    signal,
  });
}

/** Whether the caller may download an export (the daemon's gate resolved
 * server-side, incl. the ADMINS owner check the browser can't compute). */
export async function fetchExportStatus(
  signal?: AbortSignal,
): Promise<{ authorized: boolean }> {
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/export/status`, {
    headers: await ownerHeaders(),
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `preview-server /export/status: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as { authorized: boolean };
}

/** Renown auth state served by the daemon's /auth endpoints. `pending`
 * is set while a Renown console login is awaiting browser approval;
 * `startedAt` (epoch ms) is when the daemon started it (older daemons omit it). */
export type AuthState = {
  authenticated: boolean;
  address?: string;
  pending?: { loginUrl: string; startedAt?: number };
};

/** Current Renown auth state (read-only; does not advance the login). */
export async function fetchAuthStatus(
  signal?: AbortSignal,
): Promise<AuthState> {
  const { base } = await resolvePreviewConfig();
  const res = await fetch(`${base}/auth/status`, {
    headers: await ownerHeaders(),
    signal,
  });
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
    headers: await ownerHeaders(),
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
    headers: await ownerHeaders(),
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
    headers: await ownerHeaders(),
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
