/**
 * The Studio agent's session, read from its files: no Renown, no network,
 * nothing made. Light, so `whoami` and the start path can use it.
 *
 * The agent signs as a labelled session of the person (D10): a P-256 key in
 * the store's data folder (`.ph/sessions/vetra-agent-vetra-agent.json`), its
 * credential signed by the person. Nobody logged in: the pseudonym issues it
 * at the agent's first write, with no click. A Renown login, and every cloud
 * Studio: the person approves the session once at Renown's console
 * ("Authorize agent"). Sub-agents act under the top-level agent's session.
 * The credential's record in the data folder is what the store accepts;
 * withdrawing it stops the agent at once.
 */
import { listCredentialRecords } from "@powerhousedao/shared/clis/credential-records";
import {
  identityDataDir,
  pseudonymLabel,
  readActiveIdentity,
  shortAddress,
} from "@powerhousedao/shared/clis/identity";
import {
  approvedSessionCredential,
  credentialEndsWithin,
  readSessionFile,
  SESSION_RENEW_DAYS,
  sessionCredentialFor,
  sessionFilePath,
  sessionWithdrawn,
  type SessionFile,
} from "@powerhousedao/shared/clis/sessions";
import { isAdminAddress, requireAdminIdentity } from "./owner-rule.js";

type Env = Readonly<Record<string, string | undefined>>;

/** The top-level agent definition; its sub-agents act under its session. */
export const AGENT_DEFINITION = "vetra-agent";

/** What the agent's session is called, and its credential signs. */
export const AGENT_LABEL = `vetra agent ${AGENT_DEFINITION}`;

/** The store's data folder of a Studio in `workdir`. */
export function agentDataDir(workdir: string, env: Env = process.env): string {
  return identityDataDir(workdir, env);
}

/** The agent session's file. */
export function agentSessionFile(workdir: string, env: Env = process.env): string {
  return sessionFilePath({
    place: "data-folder",
    label: AGENT_LABEL,
    address: "",
    dataDir: agentDataDir(workdir, env),
    env,
  });
}

/** What the agent acts as, as its files say. */
export interface AgentStatus {
  /**
   * `renown`: a wallet approved the session (or must: a Renown login, a
   * cloud Studio). `pseudonym`: the person's pseudonym, which issues the
   * credential itself.
   */
  kind: "renown" | "pseudonym";
  /** It signs now; a pseudonym's credential is issued at the first write. */
  authorized: boolean;
  /** Whom it acts for; unset while there is no pseudonym yet. */
  address?: string;
  /** "Anonymous 0x1a2b...9f3c", the Renown username, or a short address. */
  who?: string;
  /** The session's own label. */
  session: string;
  /** The session key's did:key, once it has one. */
  key?: string;
  expiresAt?: string;
  /** The store holds the credential's record. */
  recorded: boolean;
  /** The store withdrew the credential: the agent signs nothing until authorized again. */
  withdrawn: boolean;
  /** Only a Renown wallet's approval lets it sign ("Authorize agent"). */
  needsApproval: boolean;
  /**
   * The pseudonym must issue a credential and its key is locked with a
   * password nobody gave (`PH_IDENTITY_PASSWORD`): the Studio has no terminal
   * to ask it on.
   */
  locked: boolean;
}

function recordedIn(dataDir: string, session: SessionFile | undefined): boolean {
  if (!session) return false;
  return listCredentialRecords({ dataDir }).some((r) => r.sessionDid === session.did);
}

/**
 * The agent's status in `workdir`, from its files. In a cloud Studio
 * (`cloud`, by default the owner rule's test) only a session the owner (an
 * `ADMINS` wallet) approved signs; a credential of any other wallet reads as
 * none.
 */
export function readAgentStatus(
  workdir: string,
  o: { cloud?: boolean; env?: Env } = {},
): AgentStatus {
  const env = o.env ?? process.env;
  const cloud = o.cloud ?? requireAdminIdentity();
  const dataDir = agentDataDir(workdir, env);
  const session = readSessionFile(agentSessionFile(workdir, env));
  const base = { session: AGENT_LABEL, ...(session ? { key: session.did } : {}) };
  const approved = session && approvedSessionCredential(session, { dataDir, env });
  const owned =
    approved && (!cloud || isAdminAddress(approved.issuer.ethereumAddress, env.ADMINS));
  if (session && approved && owned) {
    const withdrawn = sessionWithdrawn({ dataDir, session });
    const address = approved.issuer.ethereumAddress;
    return {
      ...base,
      kind: "renown",
      authorized: !withdrawn,
      address,
      who: shortAddress(address),
      ...(approved.expirationDate ? { expiresAt: approved.expirationDate } : {}),
      recorded: recordedIn(dataDir, session),
      withdrawn,
      needsApproval: withdrawn,
      locked: false,
    };
  }
  const identity = cloud ? undefined : readActiveIdentity({ dataDir, env });
  if (cloud || identity?.kind === "renown") {
    return {
      ...base,
      kind: "renown",
      authorized: false,
      ...(identity ? { address: identity.address, who: identity.label } : {}),
      recorded: false,
      withdrawn: false,
      needsApproval: true,
      locked: false,
    };
  }
  // The pseudonym's: issued by itself, at the first write if there is none.
  const own =
    identity && session ? sessionCredentialFor(session, identity.address) : undefined;
  const withdrawn = Boolean(session && own && sessionWithdrawn({ dataDir, session }));
  // Its key is unlocked only to issue: none yet, or one near its end.
  const issues = !own || credentialEndsWithin(own, SESSION_RENEW_DAYS);
  const locked = Boolean(identity?.encrypted && issues && env.PH_IDENTITY_PASSWORD === undefined);
  return {
    ...base,
    kind: "pseudonym",
    authorized: !withdrawn && !locked,
    locked,
    ...(identity ? { address: identity.address, who: pseudonymLabel(identity.address) } : {}),
    ...(own?.expirationDate ? { expiresAt: own.expirationDate } : {}),
    recorded: Boolean(own) && recordedIn(dataDir, session),
    withdrawn,
    needsApproval: false,
  };
}
