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

/** The workdir's Renown instance (builds + caches on first use). The CLI's DID
 * is stable across calls. */
export function getRenown(workdir: string, renownUrl: string): Promise<IRenown> {
  return entryFor(workdir, renownUrl).renown;
}

/** Snapshot of the workdir's Renown auth, including any in-flight login the
 * studio "Authorize agent" button should surface a URL for. */
export interface AuthState {
  authenticated: boolean;
  address?: string;
  /** Set while a console login is awaiting browser approval. */
  pending?: { loginUrl: string };
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
  const renown = await entry.renown;
  if (renown.user) {
    return { authenticated: true, address: renown.user.address };
  }
  const { url, sessionId } = startLogin(renown);
  entry.pending = { sessionId, loginUrl: url };
  return { authenticated: false, pending: { loginUrl: url } };
}

/** Current auth + pending-login snapshot for the studio panel. */
export async function getAuthState(
  workdir: string,
  renownUrl: string,
): Promise<AuthState> {
  const entry = entryFor(workdir, renownUrl);
  const renown = await entry.renown;
  if (renown.user) {
    return { authenticated: true, address: renown.user.address };
  }
  return {
    authenticated: false,
    ...(entry.pending ? { pending: { loginUrl: entry.pending.loginUrl } } : {}),
  };
}

/** Poll the pending login for up to `timeoutMs` and, once the user has approved
 * in the browser, store the credential. Returns the resulting state; `pending`
 * stays true if approval hasn't landed yet (caller retries). */
export async function confirmAuth(
  workdir: string,
  renownUrl: string,
  timeoutMs: number,
): Promise<AuthState> {
  const entry = entryFor(workdir, renownUrl);
  const renown = await entry.renown;
  if (renown.user) {
    return { authenticated: true, address: renown.user.address };
  }
  if (!entry.pending) {
    return { authenticated: false };
  }
  const result = await pollLogin(renown, entry.pending.sessionId, timeoutMs);
  if (result.status === "ready") {
    entry.pending = undefined;
    return { authenticated: true, address: result.user.address };
  }
  return { authenticated: false, pending: { loginUrl: entry.pending.loginUrl } };
}

/** Clear the stored credential and any pending login. The keypair (the agent's
 * `did:key`) is kept so re-authorizing returns to the same identity. */
export async function logoutAuth(
  workdir: string,
  renownUrl: string,
): Promise<AuthState> {
  const entry = entryFor(workdir, renownUrl);
  const renown = await entry.renown;
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
