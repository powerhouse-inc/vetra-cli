// Who is a member of this Studio, and in which role (P6-1). Security-sensitive:
// every lookup failure fails closed (no new access; a cached verdict only
// until its TTL), and team state is read only through acceptedTeam() (P6-2),
// which the trust ledger (task 1.8) has already filtered.
import type { StudioTeamState } from "vetra-app/document-models/studio-team";

import { isAdminAddress } from "../auth/renown.js";
import type { OrgMembership } from "./renown-orgs.js";
import { mapOrgRole, publisherCapable, type Member, type StudioRoleName } from "./roles.js";

export const MEMBERSHIP_TTL_MS = 60_000;
export const REFUSAL_TTL_MS = 15_000;

export class MembershipUnavailableError extends Error {
  override name = "MembershipUnavailableError";
}

export interface MembershipDeps {
  orgId: string | null;
  /** The ADMINS env value (personal Studios). */
  admins: string;
  fetchOrgMembership(orgId: string, address: string): Promise<OrgMembership | null>;
  /** Team state already filtered to trust-accepted operations. */
  acceptedTeam(): Promise<StudioTeamState>;
  appDid(): Promise<string | null>;
  now(): number;
}

export interface Membership {
  /**
   * The member, or null (refused). Throws MembershipUnavailableError when the
   * lookup failed and no cached verdict is still valid: callers must refuse.
   */
  resolve(address: string): Promise<Member | null>;
  /** The org role only, ignoring team state. Same failure behaviour as resolve. */
  resolveBase(address: string): Promise<{ role: StudioRoleName; name: string | null } | null>;
  invalidate(address?: string): void;
}

export function createMembership(deps: MembershipDeps): Membership {
  const cache = new Map<string, { verdict: Member | null; expiresAt: number }>();

  async function resolveBase(address: string) {
    const addr = address.toLowerCase();
    if (deps.orgId === null) {
      return isAdminAddress(addr, deps.admins) ? { role: "owner" as const, name: null } : null;
    }
    try {
      const m = await deps.fetchOrgMembership(deps.orgId, addr);
      if (!m) return null;
      const role = mapOrgRole({
        role: m.role,
        status: m.status,
        publisherCapable: publisherCapable(m, await deps.appDid()),
      });
      return role ? { role, name: null } : null;
    } catch (err) {
      throw unavailable(err);
    }
  }

  async function compute(addr: string): Promise<Member | null> {
    const base = await resolveBase(addr);
    if (deps.orgId === null) {
      return base && { address: addr, name: null, role: base.role, reviewer: false };
    }
    let team: StudioTeamState;
    try {
      team = await deps.acceptedTeam();
    } catch (err) {
      throw unavailable(err);
    }
    const same = (a: string) => a.toLowerCase() === addr;

    if (base) {
      let role = base.role;
      // Overrides may only lower Maker -> Viewer; the latest one wins.
      const override = [...team.roleOverrides].reverse().find((o) => same(o.address));
      if (role === "maker" && override?.role === "VIEWER") role = "viewer";
      const reviewer = team.reviewers.find((r) => same(r.address));
      return {
        address: addr,
        name: base.name ?? reviewer?.name ?? null,
        role,
        reviewer: !!reviewer,
      };
    }

    const now = deps.now();
    const guest = team.guests.find(
      (g) => same(g.address) && !g.revokedAt && Date.parse(g.expiresAt) > now,
    );
    if (!guest) return null;
    return {
      address: addr,
      name: guest.name ?? null,
      role: "guest",
      reviewer: false,
      guest: {
        id: guest.id,
        changeId: guest.changeId,
        rights: guest.rights,
        expiresAt: guest.expiresAt,
      },
    };
  }

  return {
    async resolve(address) {
      const addr = address.toLowerCase();
      const hit = cache.get(addr);
      if (hit && hit.expiresAt > deps.now()) return hit.verdict;
      const verdict = await compute(addr);
      cache.set(addr, {
        verdict,
        expiresAt: deps.now() + (verdict ? MEMBERSHIP_TTL_MS : REFUSAL_TTL_MS),
      });
      return verdict;
    },
    resolveBase,
    invalidate(address) {
      if (address === undefined) cache.clear();
      else cache.delete(address.toLowerCase());
    },
  };
}

function unavailable(err: unknown): MembershipUnavailableError {
  if (err instanceof MembershipUnavailableError) return err;
  return new MembershipUnavailableError(
    `membership lookup failed: ${err instanceof Error ? err.name : "unknown error"}`,
  );
}
