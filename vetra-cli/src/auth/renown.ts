/**
 * Node Renown auth — the agent's identity/auth provider.
 *
 * Wraps `@renown/sdk/node` so the agent authenticates as the user's
 * Ethereum-wallet identity. The agent holds a stable `did:key`; a console login
 * (see login-flow.ts) delegates the user's wallet to it, after which we can mint
 * no-`aud` bearer tokens and sign documents — for Vetra Cloud and any other
 * Renown-protected service.
 *
 * Keyed by workdir so each workdir owns its identity: the keypair and the
 * stored credential live under `<workdir>/.ph/`, alongside the embedded
 * reactor's state. `PH_RENOWN_PRIVATE_KEY` overrides the on-disk keypair for
 * pre-provisioned deployed agents.
 */
import path from "node:path";
import {
  RenownBuilder,
  generateAccessToken,
  getAuthStatus,
  type AuthStatusResult,
  type CreateBearerTokenOptions,
  type IRenown,
  type ISigner,
} from "@renown/sdk/node";
import { pollLogin, startLogin } from "./login-flow.js";

const APP_NAME = "vetra-cli";

interface PendingLogin {
  sessionId: string;
  loginUrl: string;
  /** When the login was started (epoch ms). */
  startedAt: number;
}

/** The pending login as the Studio sees it (the session id stays here). */
function shownLogin(pending: PendingLogin): { loginUrl: string; startedAt: number } {
  return { loginUrl: pending.loginUrl, startedAt: pending.startedAt };
}

interface CloudAuthEntry {
  renown: Promise<IRenown>;
  pending?: PendingLogin;
}

const entries = new Map<string, CloudAuthEntry>();

function keyFor(workdir: string): string {
  return path.resolve(workdir);
}

function entryFor(workdir: string, renownUrl: string): CloudAuthEntry {
  const key = keyFor(workdir);
  let entry = entries.get(key);
  if (!entry) {
    const renown = new RenownBuilder(APP_NAME, {
      keyPath: path.join(key, ".ph", ".keypair.json"),
      storagePath: path.join(key, ".ph", ".renown.json"),
      baseUrl: renownUrl,
    }).build();
    entry = { renown };
    entries.set(key, entry);
  }
  return entry;
}

let requireAdminOverride: boolean | undefined;

/** Whether the agent's identity must be an ADMINS wallet: in a cloud Studio
 * (VETRA_ENVIRONMENT_ID / `config.environmentId`), unless set explicitly. */
export function requireAdminIdentity(): boolean {
  return requireAdminOverride ?? Boolean(process.env.VETRA_ENVIRONMENT_ID?.trim());
}

/** Set by the daemon from `config.environmentId` (undefined: env fallback). */
export function setRequireAdminIdentity(required: boolean | undefined): void {
  requireAdminOverride = required;
}

/** The entry's Renown, with the owner rule applied on every read: in a cloud
 * Studio a stored credential for a non-ADMINS wallet (e.g. one stored before
 * the rule existed) is cleared, so the agent reads as signed out. */
async function ownedRenown(entry: CloudAuthEntry): Promise<IRenown> {
  const renown = await entry.renown;
  const user = renown.user;
  if (user && requireAdminIdentity() && !isAdminAddress(user.address, process.env.ADMINS)) {
    entry.pending = undefined;
    await renown.logout();
  }
  return renown;
}

/** The workdir's Renown instance (builds + caches on first use). The CLI's DID
 * is stable across calls. In a cloud Studio a non-owner credential is cleared
 * first (see `ownedRenown`). */
export function getRenown(workdir: string, renownUrl: string): Promise<IRenown> {
  return ownedRenown(entryFor(workdir, renownUrl));
}

/** Snapshot of the workdir's Renown auth, including any in-flight login the
 * studio "Authorize agent" button should surface a URL for. */
export interface AuthState {
  authenticated: boolean;
  address?: string;
  /** Set while a console login is awaiting browser approval; `startedAt`
   * (epoch ms) lets the Studio start a fresh one once Renown has dropped it. */
  pending?: { loginUrl: string; startedAt: number };
  /** Why the last login was refused (e.g. `not-owner`). */
  error?: string;
}

/** Begin a console login: build the approval URL, open the browser on the host
 * when possible, and stash the session so the panel/confirm can complete it.
 * Returns the current state — `authenticated` when already signed in (no-op),
 * else `pending` with the URL the user must approve. Non-blocking. */
export async function startAuth(
  workdir: string,
  renownUrl: string,
): Promise<AuthState> {
  const entry = entryFor(workdir, renownUrl);
  const renown = await ownedRenown(entry);
  if (renown.user) {
    return { authenticated: true, address: renown.user.address };
  }
  const { url, sessionId } = startLogin(renown);
  entry.pending = { sessionId, loginUrl: url, startedAt: Date.now() };
  return { authenticated: false, pending: shownLogin(entry.pending) };
}

/** Current auth + pending-login snapshot for the studio panel. */
export async function getAuthState(
  workdir: string,
  renownUrl: string,
): Promise<AuthState> {
  const entry = entryFor(workdir, renownUrl);
  const renown = await ownedRenown(entry);
  if (renown.user) {
    return { authenticated: true, address: renown.user.address };
  }
  return {
    authenticated: false,
    ...(entry.pending ? { pending: shownLogin(entry.pending) } : {}),
  };
}

// Is `address` in the ADMINS allowlist (the Studio owner gate,
// preview-server/request-auth.ts)? Case-insensitive; empty/unset
// allowlist matches nothing (comma- or whitespace-separated wallet addresses).
export function isAdminAddress(
  address: string | undefined,
  adminsEnv: string | undefined,
): boolean {
  if (!address) return false;
  const admins = (adminsEnv ?? "")
    .split(/[\s,]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(address.toLowerCase());
}

// Re-read after an await: TS keeps the earlier `!renown.user` narrowing.
function currentUser(renown: IRenown): IRenown["user"] {
  return renown.user;
}

/** Poll the pending login for up to `timeoutMs` and, once the user has approved
 * in the browser, store the credential. Returns the resulting state; `pending`
 * stays true if approval hasn't landed yet (caller retries). */
export async function confirmAuth(
  workdir: string,
  renownUrl: string,
  timeoutMs: number,
  opts: { requireAdmin?: boolean } = {},
): Promise<AuthState> {
  const entry = entryFor(workdir, renownUrl);
  const renown = await ownedRenown(entry);
  // Cloud Studio: the agent may only hold the owner's (ADMINS) delegation. A
  // login approved with any other wallet is logged out at once, so an
  // attacker-approved console login can't become the agent's identity.
  const settle = async (address: string): Promise<AuthState> => {
    const requireAdmin = opts.requireAdmin ?? requireAdminIdentity();
    if (requireAdmin && !isAdminAddress(address, process.env.ADMINS)) {
      entry.pending = undefined;
      await renown.logout();
      return { authenticated: false, error: "not-owner" };
    }
    return { authenticated: true, address };
  };
  if (renown.user) return settle(renown.user.address);
  const pending = entry.pending;
  if (!pending) {
    return { authenticated: false };
  }
  const result = await pollLogin(renown, pending.sessionId, timeoutMs);
  if (result.status === "ready") {
    if (entry.pending === pending) entry.pending = undefined;
    return settle(result.user.address);
  }
  // Concurrent confirms (several studio hooks poll at once): another call may
  // have completed this login, and cleared `entry.pending`, while we polled.
  const user = currentUser(renown);
  if (user) return settle(user.address);
  const current = entry.pending ?? pending;
  return { authenticated: false, pending: shownLogin(current) };
}

/** Clear the stored credential and any pending login. The keypair (the agent's
 * `did:key`) is kept so re-authorizing returns to the same identity. */
export async function logoutAuth(
  workdir: string,
  renownUrl: string,
): Promise<AuthState> {
  const entry = entryFor(workdir, renownUrl);
  const renown = await ownedRenown(entry);
  entry.pending = undefined;
  if (renown.user) await renown.logout();
  return { authenticated: false };
}

/** Mint a bearer token for switchboard requests, or null if not logged in. No
 * `aud` claim — the switchboard's verifier rejects tokens that carry one. */
export async function getBearerToken(
  workdir: string,
  renownUrl: string,
  opts: CreateBearerTokenOptions = { expiresIn: 600 },
): Promise<string | null> {
  const renown = await getRenown(workdir, renownUrl);
  if (!renown.user) return null;
  return renown.getBearerToken(opts);
}

/** Mint a registry-bound bearer token (JWT `aud` = registryUrl) from the
 * agent's authorized identity, or null if not authorized. Mirrors `ph
 * publish`'s registry auth so the same identity publishes packages. */
export async function getRegistryToken(
  workdir: string,
  renownUrl: string,
  registryUrl: string,
  expiresIn = 300,
): Promise<string | null> {
  const renown = await getRenown(workdir, renownUrl);
  if (!renown.user) return null;
  const { token } = await generateAccessToken(renown, {
    expiresIn,
    aud: registryUrl,
  });
  return token;
}

/** The Renown signer for signed document pushes (write path). Its `.user` is
 * set once login succeeds. */
export async function getSigner(workdir: string, renownUrl: string): Promise<ISigner> {
  const renown = await getRenown(workdir, renownUrl);
  return renown.signer;
}

export async function getRenownStatus(
  workdir: string,
  renownUrl: string,
): Promise<AuthStatusResult> {
  const renown = await getRenown(workdir, renownUrl);
  return getAuthStatus(renown);
}
