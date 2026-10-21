/**
 * The Studio drive's access follows membership (P6-3, task 1.10).
 *
 * Mechanism: `grants` through the **main Studio switchboard** (the in-process
 * switchboard the pod already runs with AUTH_ENABLED/DOCUMENT_PERMISSIONS_ENABLED
 * for the S1 admin transport), using reactor-api's auth subgraph mutations
 * `grantDocumentPermission` / `revokeDocumentPermission` with the agent's
 * owner/member bearer. The preview reactor project stays permissions-off.
 *
 * Owners and Makers get WRITE, Viewers READ, guests nothing. ADMIN rows (the
 * owner's and the agent's) are never downgraded or revoked.
 *
 * Known limitation (recorded for M6): Renown's `organizationMembers` needs a
 * wallet-signed OrgAuthInput the pod cannot produce, so the desired set is the
 * members the pod has seen (accepted reviewers + members who authenticated).
 * `revokeUnknown: false` keeps unlisted members' existing grants; a full member
 * list is needed before unknown rows may be revoked.
 */
import type { Member } from "./roles.js";

export type DrivePermission = "READ" | "WRITE" | "ADMIN";

export interface PermissionRow {
  userAddress: string;
  permission: DrivePermission;
}

export interface DriveAccessTransport {
  list(documentId: string): Promise<PermissionRow[]>;
  grant(documentId: string, address: string, permission: DrivePermission): Promise<void>;
  revoke(documentId: string, address: string): Promise<void>;
}

export interface DriveAccessDeps {
  transport: DriveAccessTransport;
  /** The Studio drive document id. */
  documentId: string;
}

export interface SyncOptions {
  /**
   * Revoke READ/WRITE rows of addresses not in `members`. Default true: the
   * plan's "everyone else nothing". Pass false while the member list is partial
   * (the pod cannot enumerate an org's members yet).
   */
  revokeUnknown?: boolean;
}

/** The drive permission a member's role maps to; null = no drive access. */
export function drivePermissionFor(member: Member | null): DrivePermission | null {
  if (!member) return null;
  if (member.role === "owner" || member.role === "maker") return "WRITE";
  if (member.role === "viewer") return "READ";
  return null;
}

/**
 * Bring the drive's explicit READ/WRITE rows in line with `members`.
 * Never touches ADMIN rows and never grants to guests/unknown roles.
 */
export async function syncDriveAccess(
  deps: DriveAccessDeps,
  members: Member[],
  options: SyncOptions = {},
): Promise<{ granted: string[]; revoked: string[] }> {
  const revokeUnknown = options.revokeUnknown ?? true;
  const desired = new Map<string, DrivePermission | null>();
  for (const member of members) {
    desired.set(member.address.toLowerCase(), drivePermissionFor(member));
  }
  const current = await deps.transport.list(deps.documentId);
  const granted: string[] = [];
  const revoked: string[] = [];

  for (const [address, permission] of desired) {
    if (!permission) continue;
    const row = current.find((r) => r.userAddress.toLowerCase() === address);
    if (row?.permission === "ADMIN") continue;
    if (row?.permission === permission) continue;
    await deps.transport.grant(deps.documentId, address, permission);
    granted.push(address);
  }

  for (const row of current) {
    if (row.permission === "ADMIN") continue;
    const address = row.userAddress.toLowerCase();
    const known = desired.get(address);
    if (known === null) {
      // A guest (or a role that grants nothing): no drive access.
      await deps.transport.revoke(deps.documentId, address);
      revoked.push(address);
      continue;
    }
    if (known === undefined && revokeUnknown) {
      await deps.transport.revoke(deps.documentId, address);
      revoked.push(address);
    }
  }
  return { granted, revoked };
}

interface AccessInfo {
  documentAccess: { permissions: PermissionRow[] };
}

interface GrantInfo {
  grantDocumentPermission: PermissionRow;
}

interface RevokeInfo {
  revokeDocumentPermission: boolean;
}

const LIST = `query DriveAccess($id: String!) {
  documentAccess(documentIdOrSlug: $id) { permissions { userAddress permission } }
}`;
const GRANT = `mutation GrantDriveAccess($id: String!, $user: String!, $permission: DocumentPermissionLevel!) {
  grantDocumentPermission(documentIdOrSlug: $id, userAddress: $user, permission: $permission) {
    userAddress permission
  }
}`;
const REVOKE = `mutation RevokeDriveAccess($id: String!, $user: String!) {
  revokeDocumentPermission(documentIdOrSlug: $id, userAddress: $user)
}`;

export interface SwitchboardTransportOptions {
  /** The Studio switchboard's GraphQL URL (`ReactorContext.switchboardUrl`). */
  url: string;
  /** The agent's Renown bearer (no `aud`; the switchboard verifier refuses one). */
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

/** The auth-subgraph client. Fails closed on any transport or GraphQL error. */
export function createSwitchboardDriveAccess(opts: SwitchboardTransportOptions): DriveAccessTransport {
  const doFetch = opts.fetch ?? fetch;
  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = await opts.token();
    if (!token) throw new Error("the Studio agent is not signed in (no bearer for the switchboard)");
    const res = await doFetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string }[] } | null;
    if (!res.ok || !body || body.errors?.length || !body.data) {
      throw new Error(
        `Studio switchboard refused the permission change: ${body?.errors?.[0]?.message ?? `HTTP ${res.status}`}`,
      );
    }
    return body.data;
  }

  return {
    async list(documentId) {
      const data = await gql<AccessInfo>(LIST, { id: documentId });
      return data.documentAccess.permissions.filter(
        (p): p is PermissionRow => p.permission === "READ" || p.permission === "WRITE" || p.permission === "ADMIN",
      );
    },
    async grant(documentId, address, permission) {
      await gql<GrantInfo>(GRANT, { id: documentId, user: address.toLowerCase(), permission });
    },
    async revoke(documentId, address) {
      await gql<RevokeInfo>(REVOKE, { id: documentId, user: address.toLowerCase() });
    },
  };
}
