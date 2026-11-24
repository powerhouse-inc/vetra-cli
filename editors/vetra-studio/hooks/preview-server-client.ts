/**
 * Client-side bindings for the vetra preview-server.
 *
 * The server runs in the vetra daemon (separate process from Connect) on an
 * OS port of its own. The daemon writes its address and the Studio's origin
 * into `studio.config.json`, which the Studio's Connect serves next to the
 * bundle (read per request, 404 while missing); this module fetches it and
 * caches it once read (a missing or failed read is retried on the next call)
 * — no JS asset is mutated. Until it is read, nothing is sent: the local API's
 * address is unknown, and a guessed port could be another Studio's.
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
 * Studio only: `aud` = the Studio's origin as studio.config.json names it
 * (`studioOrigin`, so `localhost` and `127.0.0.1` never disagree), sent to a
 * direct base too. A token is worthless at any other Studio (or the
 * switchboard, which refuses `aud` tokens). The daemon checks the wallet
 * against the Studio's owner (ADMINS); without it, 401. No bearer is sent
 * while the config names no origin.
 */

/** Thrown while studio.config.json has not named the local API. */
export const LOCAL_API_UNKNOWN =
  "The Studio's local API is not known yet (studio.config.json not served).";

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
    if (!config.loaded || !config.studioOrigin) return {};
    const token = await tokenProvider(config.studioOrigin);
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

// Component tests (vitest) render the editor with no Connect serving the
// config: it reads as a local Studio's (no environment id) whose local API is
// unknown, without a request. Safe access: package builds may lack
// import.meta.env.
let skipOverride: boolean | undefined;
const skipConfigRead = () =>
  skipOverride ??
  (import.meta as { env?: { MODE?: string } }).env?.MODE === "test";

/** Tests only: read studio.config.json (false) or skip it (true). */
export function setPreviewConfigSkipForTests(skip: boolean | undefined): void {
  skipOverride = skip;
}

interface PreviewConfig {
  // Absolute preview-server base (proxied `<proxy>/preview`, or a direct URL);
  // null until studio.config.json names it.
  base: string | null;
  // The Studio's origin: the `aud` of owner bearers.
  studioOrigin?: string;
  // Origin+prefix to resolve proxy-relative `proxiedUrl`s against when the base
  // is a proxied `/preview` mount; undefined for a direct/loopback base.
  proxyBase?: string;
  // The studio's cloud environment document id, when the daemon stamped one.
  environmentId?: string;
  // The Studio drive's id as the daemon stamped it; an open tab compares it
  // with the selected drive after the Studio's drive changes (Task 5.SIG).
  studioDriveId?: string;
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
  if (skipConfigRead()) return { base: null, loaded: true };
  try {
    const res = await fetch(`${bundleBase()}studio.config.json`, {
      cache: "no-store",
    });
    if (res.ok) {
      const cfg = (await res.json()) as {
        previewServerUrl?: string;
        studioOrigin?: string;
        environmentId?: string;
        packageRegistryUrl?: string;
        cloudSwitchboardUrl?: string;
        studioDriveId?: string;
      };
      // A file without the local API's address is one written for another
      // purpose: read again next time.
      if (cfg.previewServerUrl) {
        return {
          base: cfg.previewServerUrl.replace(/\/+$/, ""),
          proxyBase: computeProxyBase(cfg.previewServerUrl),
          studioOrigin: cfg.studioOrigin,
          environmentId: cfg.environmentId,
          studioDriveId: cfg.studioDriveId,
          packageRegistryUrl: cfg.packageRegistryUrl,
          cloudSwitchboardUrl: cfg.cloudSwitchboardUrl,
          loaded: true,
        };
      }
    }
  } catch {
    // not served yet: read again on the next call
  }
  return { base: null, loaded: false };
}

/** The local API's base, or `LOCAL_API_UNKNOWN` while the config isn't read. */
async function previewBase(): Promise<{ base: string; proxyBase?: string }> {
  const { base, proxyBase } = await resolvePreviewConfig();
  if (!base) throw new Error(LOCAL_API_UNKNOWN);
  return { base, proxyBase };
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

/** The Studio drive the daemon stamped, or null when it stamped none. */
export async function resolveStudioDriveId(): Promise<string | null> {
  const config = await resolvePreviewConfig();
  return config.studioDriveId ?? null;
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

// Every route acts on the project the Studio runs in (the Cli's workdir): no
// call names a project.

export type ResolveResult =
  | { kind: "no-target" }
  /** The Studio's workdir is no Reactor Package project. */
  | { kind: "unknown-project"; error: string }
  | { kind: "project-stopped" }
  | { kind: "starting"; driveId?: string }
  | {
      kind: "ready";
      driveId: string;
      documentId: string;
      url: string;
      proxiedUrl?: string;
    };

export type StartResult =
  | {
      kind: "started";
      projectPath: string;
      instanceId: string;
      driveId?: string;
    }
  | {
      kind: "already-running";
      projectPath: string;
      instanceId: string;
      driveId?: string;
      status: "starting" | "ready";
    }
  | { kind: "unknown-project"; error: string }
  | { kind: "failed"; error: string };

export async function fetchResolve(args: {
  doc: string;
  drive?: string;
  /** The project's preview drive root (no doc, no drive). */
  home?: boolean;
  signal?: AbortSignal;
}): Promise<ResolveResult> {
  const params = new URLSearchParams({ doc: args.doc });
  if (args.drive) params.set("drive", args.drive);
  if (args.home) params.set("home", "1");
  const { base, proxyBase } = await previewBase();
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

/** The Preview run's state as `GET /preview/status` words it. */
export type PreviewStatus =
  | { kind: "ready" }
  | { kind: "starting" }
  | { kind: "stopped" }
  /** A start would be refused: no project, or a preflight check fails. */
  | { kind: "unavailable"; reason: string; hint?: string }
  | { kind: "failed"; error: string };

/** Why the Preview is or is not there; undefined when the caller is refused. */
export async function fetchPreviewStatus(
  args: { signal?: AbortSignal } = {},
): Promise<PreviewStatus | undefined> {
  const { base } = await previewBase();
  const res = await fetch(`${base}/preview/status`, {
    headers: await ownerHeaders(),
    signal: args.signal,
  });
  if (isRefused(res.status)) return undefined;
  if (!res.ok) {
    throw new Error(
      `preview-server /preview/status: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as PreviewStatus;
}

export type ProjectPackageResult =
  | { kind: "ok"; name: string; version: string }
  | { kind: "unknown-project"; error: string }
  | { kind: "no-package"; error: string };

/** The project's package identity (name + version) from its package.json. */
export async function fetchProjectPackage(
  args: { signal?: AbortSignal } = {},
): Promise<ProjectPackageResult> {
  const { base } = await previewBase();
  const res = await fetch(`${base}/project-package`, {
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
      packageName: string;
      localVersion: string | null;
      publishedVersion: string | null;
      upToDate: boolean;
      needsRelease: boolean;
      reason: string;
    }
  | { kind: "unknown-project"; error: string }
  | { kind: "no-package"; error: string }
  | { kind: "unknown"; error: string };

/** Whether the project's current source is already published (up to date) or
 * needs a new release, by comparing its content hash to the registry. */
export async function fetchReleaseStatus(
  args: { signal?: AbortSignal } = {},
): Promise<ReleaseStatusResult> {
  const { base } = await previewBase();
  const res = await fetch(`${base}/release-status`, {
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
      packageName: string;
      version: string;
      registry: string;
      published: boolean;
    }
  | { kind: "unknown-project"; error: string }
  | { kind: "no-package"; error: string }
  | { kind: "auth-required"; error: string }
  | { kind: "failed"; error: string };

/** Build + publish the project's package to the registry (skipped server-side
 * when the source is already the latest published version). Returns the
 * published name + version to install into an environment. All outcomes carry a
 * discriminated body, so this doesn't throw on non-2xx. */
export async function publishProject(
  args: { signal?: AbortSignal } = {},
): Promise<PublishProjectResult> {
  const { base } = await previewBase();
  const res = await fetch(`${base}/publish`, {
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
      error: isRefused(res.status)
        ? OWNER_REQUIRED
        : `preview-server /publish: ${res.status} ${res.statusText}`,
    };
  }
  return body;
}

export async function fetchStart(
  args: { signal?: AbortSignal } = {},
): Promise<StartResult> {
  const { base } = await previewBase();
  const res = await fetch(`${base}/start`, {
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
      error: isRefused(res.status)
        ? OWNER_REQUIRED
        : `preview-server /start: ${res.status} ${res.statusText}`,
    };
  }
  return body;
}

export interface ProjectHostLink {
  name: string;
  url: string;
}

/** One of the project's own hosts, as `GET /hosts` words it. */
export type ProjectHostState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "stopping" }
  | {
      kind: "running";
      pid: number;
      startedAt: string;
      verb: string;
      links: ProjectHostLink[];
      webUrl?: string;
      startedHere: boolean;
    }
  | { kind: "failed"; reason: string; logFile?: string };

export interface ProjectHost {
  host: string;
  name: string;
  runner: string;
  /** False: it runs in a terminal, with `command`. */
  startable: boolean;
  command: string;
  state: ProjectHostState;
}

export type ProjectHostsResult =
  | { kind: "ok"; projectPath: string; hosts: ProjectHost[] }
  | { kind: "none"; projectPath: string; reason: string }
  | { kind: "unknown-project"; error: string }
  /** The caller is not the Studio's owner. */
  | { kind: "refused"; error: string };

/** The project's own hosts and which of them run. */
export async function fetchProjectHosts(
  args: { signal?: AbortSignal } = {},
): Promise<ProjectHostsResult> {
  const { base } = await previewBase();
  const res = await fetch(`${base}/hosts`, {
    headers: await ownerHeaders(),
    signal: args.signal,
  });
  if (isRefused(res.status)) return { kind: "refused", error: OWNER_REQUIRED };
  const body = (await res
    .json()
    .catch(() => null)) as ProjectHostsResult | null;
  if (!body?.kind) {
    throw new Error(`preview-server /hosts: ${res.status} ${res.statusText}`);
  }
  return body;
}

export type ProjectHostActionResult =
  | { kind: "ok"; host: ProjectHost }
  | {
      kind: "failed" | "refused" | "unknown-host" | "unknown-project";
      error: string;
    };

/** Starts (`ph run <host> dev`) or stops one of the project's hosts. A start
 * answers once it is under way; the list says how it went. */
export async function fetchProjectHostAction(
  action: "start" | "stop",
  host: string,
  args: { signal?: AbortSignal } = {},
): Promise<ProjectHostActionResult> {
  const { base } = await previewBase();
  const res = await fetch(
    `${base}/hosts/${action}?host=${encodeURIComponent(host)}`,
    { method: "POST", headers: await ownerHeaders(), signal: args.signal },
  );
  const body = (await res
    .json()
    .catch(() => null)) as ProjectHostActionResult | null;
  if (!body?.kind) {
    return {
      kind: "failed",
      error: isRefused(res.status)
        ? OWNER_REQUIRED
        : `preview-server /hosts/${action}: ${res.status} ${res.statusText}`,
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
export async function fetchRestart(
  args: { signal?: AbortSignal } = {},
): Promise<StartResult | null> {
  const { base } = await previewBase();
  const res = await fetch(`${base}/restart`, {
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
  const { base } = await previewBase();
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
  const { base } = await previewBase();
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
  const { base } = await previewBase();
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

/** The agent's session as the daemon's /auth endpoints serve it. `pending`
 * is set while a Renown console approval is awaiting the wallet; `ageMs`
 * is how old it is by the daemon's clock at response time (older daemons
 * omit it, and `startedAt`, epoch ms on the daemon's clock). */
export type AuthState = {
  /** The agent signs now: a Renown wallet approved it, or (a local Studio,
   * nobody logged in) it acts as the user's pseudonym. */
  authenticated: boolean;
  /** Whom it acts for: an approved Renown wallet, or the pseudonym. */
  kind?: "renown" | "pseudonym";
  address?: string;
  /** "Anonymous 0x1a2b...9f3c" for a pseudonym. */
  who?: string;
  /** The store withdrew the agent: it signs nothing until authorized again. */
  withdrawn?: boolean;
  /** The store holds the agent's credential's record: "Withdraw" stops it. */
  recorded?: boolean;
  /** The pseudonym's key is locked with a password the Studio cannot ask for. */
  locked?: boolean;
  pending?: { loginUrl: string; startedAt?: number; ageMs?: number };
  /** Why the last approval was refused (`not-owner`). */
  error?: string;
};

/** Current Renown auth state (read-only; does not advance the login). */
export async function fetchAuthStatus(
  signal?: AbortSignal,
): Promise<AuthState> {
  const { base } = await previewBase();
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

/** "Authorize agent": the daemon builds Renown's console page for the agent's
 * session (returned as `pending.loginUrl`), or issues a withdrawn pseudonym's
 * credential again. */
export async function startAuth(signal?: AbortSignal): Promise<AuthState> {
  const { base } = await previewBase();
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

/** Advance a pending approval: the daemon polls Renown for up to `waitMs`
 * and, once the user has approved with their wallet, keeps the credential. */
export async function confirmAuth(args?: {
  waitMs?: number;
  signal?: AbortSignal;
}): Promise<AuthState> {
  const params = new URLSearchParams();
  if (args?.waitMs != null) params.set("wait", String(args.waitMs));
  const qs = params.toString();
  const { base } = await previewBase();
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

/** "Withdraw": the store refuses the agent's credential from its next request
 * (the agent's session key is kept). */
export async function logoutAuth(signal?: AbortSignal): Promise<AuthState> {
  const { base } = await previewBase();
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

/** How long the tab waits before it reads studio.config.json again. */
const CONFIG_RETRY_MS = 2_000;

// Opens the shared EventSource once the config resolves. Guards against a
// concurrent open (the config fetch is async) and a closed prior source.
// While the config names no local API (the Cli not up yet), it tries again
// as long as someone listens; the listeners then hear "open" once, so they
// read what they missed.
function ensureSource(retried = false): void {
  if (typeof window === "undefined" || typeof EventSource === "undefined")
    return;
  if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return;
  if (creatingSource) return;
  creatingSource = true;
  void resolvePreviewConfig().then(({ base }) => {
    creatingSource = false;
    if (sharedSource && sharedSource.readyState !== EventSource.CLOSED) return;
    if (!base) {
      setTimeout(() => {
        if (listeners.size > 0) ensureSource(true);
      }, CONFIG_RETRY_MS);
      return;
    }
    const src = new EventSource(`${base}/events`);
    if (retried) {
      src.addEventListener(
        "open",
        () => {
          for (const fn of listeners) fn("open");
        },
        { once: true },
      );
    }
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
