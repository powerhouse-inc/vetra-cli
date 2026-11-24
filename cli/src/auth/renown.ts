/**
 * The Studio agent's identity: a labelled session of the person
 * (`vetra agent vetra-agent`, see `agent-files.ts`), signing and bearing with
 * `@renown/sdk/identity`'s `openSession`.
 *
 * Nobody logged in, in a local Studio: the agent acts as the person's
 * pseudonym, its credential issued at its first write with no click. A
 * Renown login, and every cloud Studio: the person approves the session once
 * at Renown's console ("Authorize agent", `startAuth`/`confirmAuth`); the
 * credential the wallet signs is kept in the session file and recorded in
 * the store's data folder. `logoutAuth` withdraws the record, which stops
 * the agent at once. A cloud Studio's agent may only act as an `ADMINS`
 * wallet. Old `.ph/vetra/agent/` files are not read.
 */
import { EventEmitter } from "node:events";
import {
  listCredentialRecords,
  withdrawCredentialRecords,
} from "@powerhousedao/shared/clis/credential-records";
import { PasswordRequiredError } from "@powerhousedao/shared/clis/identity";
import {
  credentialEndsWithin,
  readSessionFile,
  SESSION_RENEW_DAYS,
  writeSessionFile,
} from "@powerhousedao/shared/clis/sessions";
import type { ISigner } from "@powerhousedao/shared/document-model";
import type { OpenSession, SessionApproval } from "@renown/sdk/identity";
import {
  AGENT_LABEL,
  agentDataDir,
  agentSessionFile,
  readAgentStatus,
  type AgentStatus,
} from "./agent-files.js";
import { isAdminAddress, requireAdminIdentity } from "./owner-rule.js";

export { isAdminAddress, requireAdminIdentity, setRequireAdminIdentity } from "./owner-rule.js";

/** The agent's state as the Studio's "Authorize agent" control shows it. */
export interface AuthState {
  /** The agent signs now (a pseudonym's credential is issued at its first write). */
  authenticated: boolean;
  /** `renown`: a wallet approved the session; `pseudonym`: the person's pseudonym. */
  kind?: AgentStatus["kind"];
  address?: string;
  /** "Anonymous 0x1a2b...9f3c", or the wallet's short address. */
  who?: string;
  /** The store withdrew the agent: it signs nothing until authorized again. */
  withdrawn?: boolean;
  /** The store holds the record of the agent's credential: "Withdraw" stops it. */
  recorded?: boolean;
  /** The pseudonym's key is locked with a password the Studio cannot ask for. */
  locked?: boolean;
  /** Set while a console approval is awaiting the person's wallet. `startedAt`
   * is epoch ms on the daemon's clock; `ageMs` (how long ago, at response
   * time) lets the Studio start a fresh one once Renown has dropped this one. */
  pending?: { loginUrl: string; startedAt: number; ageMs: number };
  /** Why the last approval was refused (`not-owner`). */
  error?: string;
}

interface PendingApproval {
  approval: SessionApproval;
  startedAt: number;
}

interface AgentEntry {
  pending?: PendingApproval;
  /** The session opened by the last write; dropped on every change. */
  session?: Promise<OpenSession>;
}

const entries = new Map<string, AgentEntry>();
const changes = new EventEmitter();

function entryFor(workdir: string): AgentEntry {
  const key = agentDataDir(workdir);
  let entry = entries.get(key);
  if (!entry) {
    entry = {};
    entries.set(key, entry);
  }
  return entry;
}

/** Tell the agent's watchers (the reactor's writes, its socket) that it changed. */
function changed(workdir: string): void {
  entryFor(workdir).session = undefined;
  changes.emit("change", agentDataDir(workdir));
}

/** Calls `listener` whenever the agent of `workdir` is authorized or withdrawn. */
export function onAgentChange(workdir: string, listener: () => void): () => void {
  const key = agentDataDir(workdir);
  const on = (changedKey: string) => {
    if (changedKey === key) listener();
  };
  changes.on("change", on);
  return () => {
    changes.off("change", on);
  };
}

/** The pending approval as the Studio sees it. */
function shownApproval(
  pending: PendingApproval,
  now = Date.now(),
): NonNullable<AuthState["pending"]> {
  return {
    loginUrl: pending.approval.url,
    startedAt: pending.startedAt,
    ageMs: Math.max(0, now - pending.startedAt),
  };
}

function stateOf(status: AgentStatus, entry: AgentEntry): AuthState {
  return {
    authenticated: status.authorized,
    kind: status.kind,
    ...(status.address ? { address: status.address } : {}),
    ...(status.who ? { who: status.who } : {}),
    ...(status.withdrawn ? { withdrawn: true } : {}),
    ...(status.recorded ? { recorded: true } : {}),
    ...(status.locked ? { locked: true } : {}),
    ...(entry.pending && !status.authorized ? { pending: shownApproval(entry.pending) } : {}),
  };
}

/** Removes the credential a wallet approved from the session file. */
function dropApproval(workdir: string): void {
  const file = agentSessionFile(workdir);
  const session = readSessionFile(file);
  if (!session?.credential) return;
  const { credential: _dropped, ...kept } = session;
  writeSessionFile(file, kept);
}

/** A cloud Studio's agent holds only the owner's approval: any other is dropped. */
function applyOwnerRule(workdir: string, cloud: boolean): void {
  if (!cloud) return;
  const session = readSessionFile(agentSessionFile(workdir));
  const issuer = session?.credential?.issuer.ethereumAddress;
  if (issuer && session.credential?.credentialSubject.id === session.did &&
    !isAdminAddress(issuer, process.env.ADMINS)) {
    dropApproval(workdir);
  }
}

/** The agent's state for the Studio's control. */
export function getAuthState(
  workdir: string,
  _renownUrl?: string,
  opts: { cloud?: boolean } = {},
): Promise<AuthState> {
  const cloud = opts.cloud ?? requireAdminIdentity();
  applyOwnerRule(workdir, cloud);
  return Promise.resolve(stateOf(readAgentStatus(workdir, { cloud }), entryFor(workdir)));
}

/**
 * "Authorize agent". Already signing: nothing to do. A pseudonym the store
 * withdrew: issue it a new credential. Otherwise start the approval at
 * Renown's console and return its page (`pending.loginUrl`). Non-blocking.
 */
export async function startAuth(
  workdir: string,
  renownUrl: string,
  opts: { cloud?: boolean } = {},
): Promise<AuthState> {
  const cloud = opts.cloud ?? requireAdminIdentity();
  applyOwnerRule(workdir, cloud);
  const entry = entryFor(workdir);
  const status = readAgentStatus(workdir, { cloud });
  if (status.authorized) return stateOf(status, entry);
  if (status.locked) return { ...stateOf(status, entry), error: "locked" };
  if (status.kind === "pseudonym") {
    // The person asked: a credential issued now lifts the withdrawal.
    await openAgentSession(workdir, { cloud, reissueWithdrawn: true });
    changed(workdir);
    return stateOf(readAgentStatus(workdir, { cloud }), entry);
  }
  const { startSessionApproval } = await import("@renown/sdk/identity");
  const approval = startSessionApproval({
    dataDir: agentDataDir(workdir),
    label: AGENT_LABEL,
    renownUrl,
  });
  const startedAt = Date.now();
  entry.pending = { approval, startedAt };
  return { ...stateOf(status, entry), pending: shownApproval(entry.pending, startedAt) };
}

/** Waits up to `timeoutMs` for the person to approve the pending session at
 * Renown's console, then keeps the credential their wallet signed. A cloud
 * Studio's agent keeps only an `ADMINS` wallet's approval (`requireAdmin`).
 * `pending` stays set while the approval has not landed (the caller retries). */
export async function confirmAuth(
  workdir: string,
  renownUrl: string,
  timeoutMs: number,
  opts: { requireAdmin?: boolean } = {},
): Promise<AuthState> {
  const requireAdmin = opts.requireAdmin ?? requireAdminIdentity();
  const entry = entryFor(workdir);
  const current = () => stateOf(readAgentStatus(workdir, { cloud: requireAdmin }), entry);
  const pending = entry.pending;
  if (!pending) return current();
  const status = readAgentStatus(workdir, { cloud: requireAdmin });
  if (status.authorized) {
    if (entry.pending === pending) entry.pending = undefined;
    return current();
  }
  const { pollSessionApproval } = await import("@renown/sdk/identity");
  const result = await pollSessionApproval({
    approval: pending.approval,
    renownUrl,
    timeoutMs,
    target: { dataDir: agentDataDir(workdir) },
    ...(requireAdmin
      ? { accept: (address: string) => isAdminAddress(address, process.env.ADMINS) }
      : {}),
  });
  if (result.status === "refused") {
    if (entry.pending === pending) entry.pending = undefined;
    return { authenticated: false, error: "not-owner" };
  }
  if (result.status === "ready") {
    if (entry.pending === pending) entry.pending = undefined;
    changed(workdir);
  }
  // Concurrent confirms: another call may have completed this approval.
  return current();
}

/** "Withdraw": withdraws the agent's credential in the store, which refuses it
 * from its next request, and forgets a wallet's approval. The session key is
 * kept, so authorizing again keeps the agent's did:key. */
export function logoutAuth(workdir: string, _renownUrl?: string): Promise<AuthState> {
  const entry = entryFor(workdir);
  entry.pending = undefined;
  const dataDir = agentDataDir(workdir);
  const session = readSessionFile(agentSessionFile(workdir));
  if (session) {
    const ids = listCredentialRecords({ dataDir })
      .filter((record) => record.sessionDid === session.did)
      .map((record) => record.id);
    withdrawCredentialRecords({ dataDir, ids, by: "command" });
    if (readAgentStatus(workdir).kind === "renown") dropApproval(workdir);
  }
  changed(workdir);
  return getAuthState(workdir);
}

/** The agent stopped because nobody authorized it, or the store withdrew it. */
export class AgentNotAuthorizedError extends Error {
  constructor() {
    super(
      "The agent is not authorized to act: ask the user to click 'Authorize agent' in Vetra Studio's top bar.",
    );
    this.name = "AgentNotAuthorizedError";
  }
}

/** The pseudonym must issue the agent's credential, and its key is locked. */
export class AgentLockedError extends Error {
  constructor() {
    super(
      "The agent cannot sign: the key of the user's pseudonym is locked with a password, and the Studio has no terminal to ask it on. Set PH_IDENTITY_PASSWORD where the Studio runs.",
    );
    this.name = "AgentLockedError";
  }
}

/**
 * The agent's session, ready to sign: the session a wallet approved, else
 * (a local Studio, nobody logged in) the pseudonym's, made and issued now if
 * there is none, with its record in the store. Kept until the agent changes.
 */
export async function openAgentSession(
  workdir: string,
  o: { cloud?: boolean; reissueWithdrawn?: boolean } = {},
): Promise<OpenSession> {
  const cloud = o.cloud ?? requireAdminIdentity();
  const entry = entryFor(workdir);
  if (entry.session && !o.reissueWithdrawn) {
    const held = await entry.session.catch(() => undefined);
    // Opened again near its end, so a pseudonym's credential is renewed.
    if (held && !credentialEndsWithin(held.credential, SESSION_RENEW_DAYS)) return held;
  }
  applyOwnerRule(workdir, cloud);
  const opening = (async () => {
    const { openSession, SessionApprovalRequiredError, SessionWithdrawnError } =
      await import("@renown/sdk/identity");
    const dataDir = agentDataDir(workdir);
    try {
      return await openSession({
        dataDir,
        label: AGENT_LABEL,
        place: "data-folder",
        interactive: false,
        target: { dataDir },
        pseudonym: !cloud,
        reissueWithdrawn: o.reissueWithdrawn ?? false,
      });
    } catch (error) {
      if (error instanceof SessionApprovalRequiredError || error instanceof SessionWithdrawnError) {
        throw new AgentNotAuthorizedError();
      }
      if (error instanceof PasswordRequiredError) throw new AgentLockedError();
      throw error;
    }
  })();
  entry.session = opening;
  opening.catch(() => {
    if (entry.session === opening) entry.session = undefined;
  });
  return opening;
}

/** The agent's session when it signs now, else undefined; makes nothing it would not sign with. */
async function signingSession(workdir: string): Promise<OpenSession | undefined> {
  if (!readAgentStatus(workdir).authorized) return undefined;
  try {
    return await openAgentSession(workdir);
  } catch (error) {
    if (error instanceof AgentNotAuthorizedError) return undefined;
    throw error;
  }
}

/** A bearer of the agent's session, for the Studio's switchboard and its
 * attachments: undefined until the agent has a session it signs with, so a
 * read makes no pseudonym. */
export async function getAgentBearer(
  workdir: string,
  opts: { expiresIn?: number } = {},
): Promise<string | undefined> {
  const status = readAgentStatus(workdir);
  if (!status.authorized || !status.recorded) return undefined;
  const session = await signingSession(workdir);
  return session?.bearer({ expiresIn: opts.expiresIn ?? 600 });
}

/** The agent acting for a Renown wallet, for Vetra Cloud and other Renown-checked services. */
export interface CloudAgent {
  address: string;
  signer: ISigner;
  bearer(o?: { expiresIn?: number; aud?: string }): Promise<string>;
}

/** The agent when a Renown wallet approved it; undefined otherwise (a pseudonym is unknown to Renown). */
export async function getCloudAgent(
  workdir: string,
  _renownUrl?: string,
): Promise<CloudAgent | undefined> {
  if (readAgentStatus(workdir).kind !== "renown") return undefined;
  const session = await signingSession(workdir);
  if (!session) return undefined;
  return {
    address: session.signer.user.address,
    signer: session.actionSigner,
    bearer: (o) => session.bearer(o),
  };
}

/** A bearer (no `aud`) of the agent's Renown-approved session, or null. */
export async function getBearerToken(
  workdir: string,
  renownUrl: string,
  opts: { expiresIn?: number } = { expiresIn: 600 },
): Promise<string | null> {
  const agent = await getCloudAgent(workdir, renownUrl);
  return agent ? agent.bearer({ expiresIn: opts.expiresIn ?? 600 }) : null;
}

/** A registry-bound bearer (JWT `aud` = registryUrl) of the agent's
 * Renown-approved session, or null. Mirrors `ph publish`'s registry auth. */
export async function getRegistryToken(
  workdir: string,
  renownUrl: string,
  registryUrl: string,
  expiresIn = 300,
): Promise<string | null> {
  const agent = await getCloudAgent(workdir, renownUrl);
  return agent ? agent.bearer({ expiresIn, aud: registryUrl }) : null;
}
