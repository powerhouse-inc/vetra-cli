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
import fs from "node:fs";
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

/** Where one member's delegation to the agent's key is stored (task 1.11).
 * Relative to the workdir: the same trust boundary as the team document id. */
export const DELEGATIONS_DIR = path.join(".ph", "vetra", "team", "delegations");

function keyFor(workdir: string): string {
  return path.resolve(workdir);
}

/** The file holding `address`'s delegation credential (lower-case address). */
export function delegationFile(workdir: string, address: string): string {
  return path.join(keyFor(workdir), DELEGATIONS_DIR, `${address.trim().toLowerCase()}.json`);
}

function memberKey(workdir: string, address: string): string {
  return `member:${keyFor(workdir)}:${address.trim().toLowerCase()}`;
}

/**
 * Builds run one at a time: the first one on a fresh Studio generates the
 * agent keypair all of them share, and two concurrent builds could each
 * generate (and overwrite) a different key.
 */
let buildQueue: Promise<unknown> = Promise.resolve();

function buildEntry(options: { keyPath: string; storagePath: string }, renownUrl: string): CloudAuthEntry {
  const build = () =>
    new RenownBuilder(APP_NAME, {
      keyPath: options.keyPath,
      storagePath: options.storagePath,
      baseUrl: renownUrl,
    }).build();
  const renown = buildQueue.then(build, build);
  buildQueue = renown.then(
    () => undefined,
    () => undefined,
  );
  return { renown };
}

function entryFor(workdir: string, renownUrl: string): CloudAuthEntry {
  const key = keyFor(workdir);
  let entry = entries.get(key);
  if (!entry) {
    entry = buildEntry(
      {
        keyPath: path.join(key, ".ph", ".keypair.json"),
        storagePath: path.join(key, ".ph", ".renown.json"),
      },
      renownUrl,
    );
    entries.set(key, entry);
  }
  return entry;
}

/**
 * One entry per member: the *same* agent keypair (so every member delegates to
 * the one agent identity, P6-4) and that member's own storage file, so two
 * members' delegations coexist instead of replacing each other.
 */
function memberEntryFor(workdir: string, renownUrl: string, address: string): CloudAuthEntry {
  const key = memberKey(workdir, address);
  let entry = entries.get(key);
  if (!entry) {
    entry = buildEntry(
      {
        keyPath: path.join(keyFor(workdir), ".ph", ".keypair.json"),
        storagePath: delegationFile(workdir, address),
      },
      renownUrl,
    );
    entries.set(key, entry);
  }
  return entry;
}

/** Which identity a login/status/logout call is about. */
export interface AuthTarget {
  /** A member's own delegation (org Studios, task 1.11); absent = the Studio's
   * single identity (local Studio, or a personal cloud Studio's owner). */
  member?: string;
}

function entryForTarget(workdir: string, renownUrl: string, target: AuthTarget): CloudAuthEntry {
  return target.member
    ? memberEntryFor(workdir, renownUrl, target.member)
    : entryFor(workdir, renownUrl);
}

let requireAdminOverride: boolean | undefined;

/**
 * Whether the agent's shared identity must be an ADMINS wallet. Personal cloud
 * Studios keep that rule; an org Studio does not (P6-4, Ruling C16): every
 * admitted member's own delegation is accepted, and `ADMINS` is empty there.
 * Default follows `VETRA_ENVIRONMENT_ID` until the daemon sets it explicitly.
 */
export function requireAdminIdentity(): boolean {
  return requireAdminOverride ?? Boolean(process.env.VETRA_ENVIRONMENT_ID?.trim());
}

/** Set by the daemon: `cloud && !orgStudio` (undefined: env fallback). */
export function setRequireAdminIdentity(required: boolean | undefined): void {
  requireAdminOverride = required;
}

/** The entry's Renown, with the owner rule applied on every read: where the
 * owner rule applies, a stored credential for a non-ADMINS wallet (e.g. one
 * stored before the rule existed) is cleared, so the agent reads as signed
 * out. Member entries are never cleared: each is that member's own delegation. */
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
  /** Set while a console login is awaiting browser approval. */
  pending?: { loginUrl: string };
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
  target: AuthTarget = {},
): Promise<AuthState> {
  const entry = entryForTarget(workdir, renownUrl, target);
  const renown = target.member ? await entry.renown : await ownedRenown(entry);
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
  target: AuthTarget = {},
): Promise<AuthState> {
  const entry = entryForTarget(workdir, renownUrl, target);
  const renown = target.member ? await entry.renown : await ownedRenown(entry);
  if (renown.user) {
    return { authenticated: true, address: renown.user.address };
  }
  return {
    authenticated: false,
    ...(entry.pending ? { pending: { loginUrl: entry.pending.loginUrl } } : {}),
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
  opts: { requireAdmin?: boolean; member?: string } = {},
): Promise<AuthState> {
  const entry = entryForTarget(workdir, renownUrl, opts);
  const renown = opts.member ? await entry.renown : await ownedRenown(entry);
  // Two rules, one door: a member's own delegation is only ever stored under
  // their own address (`allowAgent`, self only), and where the single-identity
  // owner rule applies the wallet must be in ADMINS. Either way a login
  // approved with another wallet is logged out at once, so an
  // attacker-approved console login can't become someone's delegation.
  const settle = async (address: string): Promise<AuthState> => {
    const expected = opts.member?.trim().toLowerCase();
    const wrongMember = expected !== undefined && address.toLowerCase() !== expected;
    const requireAdmin = !expected && (opts.requireAdmin ?? requireAdminIdentity());
    if (wrongMember || (requireAdmin && !isAdminAddress(address, process.env.ADMINS))) {
      entry.pending = undefined;
      await renown.logout();
      return { authenticated: false, error: wrongMember ? "not-you" : "not-owner" };
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
  return { authenticated: false, pending: { loginUrl: current.loginUrl } };
}

/** Clear the stored credential and any pending login. The keypair (the agent's
 * `did:key`) is kept so re-authorizing returns to the same identity. */
export async function logoutAuth(
  workdir: string,
  renownUrl: string,
  target: AuthTarget = {},
): Promise<AuthState> {
  const entry = entryForTarget(workdir, renownUrl, target);
  const renown = target.member ? await entry.renown : await ownedRenown(entry);
  entry.pending = undefined;
  if (renown.user) await renown.logout();
  return { authenticated: false };
}

/** A member's Renown (their delegation to the agent's key), built on first use. */
export function getMemberRenown(
  workdir: string,
  renownUrl: string,
  address: string,
): Promise<IRenown> {
  return memberEntryFor(workdir, renownUrl, address).renown;
}

/** Whose delegations are stored, oldest first (the order they allowed the agent). */
export function storedDelegations(workdir: string): string[] {
  const dir = path.join(keyFor(workdir), DELEGATIONS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: Array<{ address: string; at: number }> = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    try {
      found.push({
        address: name.slice(0, -".json".length),
        at: fs.statSync(path.join(dir, name)).mtimeMs,
      });
    } catch {
      // Gone between readdir and stat: not a delegation any more.
    }
  }
  return found.sort((a, b) => a.at - b.at).map((delegation) => delegation.address);
}

/** Forget a member's delegation: in-memory instance and stored credential. */
export function forgetMemberRenown(workdir: string, address: string): void {
  entries.delete(memberKey(workdir, address));
  fs.rmSync(delegationFile(workdir, address), { force: true });
}

/**
 * The identity the Studio's shared agent acts with where no change names one
 * (the team document bootstrap, drive-access sync, C16): the single stored
 * identity, else — where the owner rule does not apply, i.e. an org Studio —
 * the first member who allowed the agent. Null when nobody has.
 */
async function actingIdentity(workdir: string, renownUrl: string): Promise<IRenown | null> {
  const renown = await getRenown(workdir, renownUrl);
  if (renown.user) return renown;
  if (requireAdminIdentity()) return null;
  for (const address of storedDelegations(workdir)) {
    try {
      const member = await getMemberRenown(workdir, renownUrl, address);
      if (member.user) return member;
    } catch {
      // A delegation that no longer loads is not an identity.
    }
  }
  return null;
}

/** Mint a bearer token for switchboard requests, or null if not logged in. No
 * `aud` claim — the switchboard's verifier rejects tokens that carry one. */
export async function getBearerToken(
  workdir: string,
  renownUrl: string,
  opts: CreateBearerTokenOptions = { expiresIn: 600 },
): Promise<string | null> {
  const renown = await actingIdentity(workdir, renownUrl);
  if (!renown) return null;
  return renown.getBearerToken(opts);
}

/** A bearer for one member's own delegation (the launch requester's, 1.11). */
export async function getMemberBearerToken(
  workdir: string,
  renownUrl: string,
  address: string,
  opts: CreateBearerTokenOptions = { expiresIn: 600 },
): Promise<string | null> {
  const renown = await getMemberRenown(workdir, renownUrl, address);
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
  const renown = await actingIdentity(workdir, renownUrl);
  if (!renown) return null;
  const { token } = await generateAccessToken(renown, {
    expiresIn,
    aud: registryUrl,
  });
  return token;
}

/** The Renown signer for signed document pushes (write path). Its `.user` is
 * set once login succeeds. */
export async function getSigner(workdir: string, renownUrl: string): Promise<ISigner> {
  const acting = await actingIdentity(workdir, renownUrl);
  if (acting) return acting.signer;
  return (await getRenown(workdir, renownUrl)).signer;
}

export async function getRenownStatus(
  workdir: string,
  renownUrl: string,
): Promise<AuthStatusResult> {
  const renown = await getRenown(workdir, renownUrl);
  return getAuthStatus(renown);
}
