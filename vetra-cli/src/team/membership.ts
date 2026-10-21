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
  /**
   * The Studio App's DID. MUST throw when the lookup fails and return null
   * ONLY when the Studio has no App: a null promotes every PUBLISHER to maker,
   * so a swallowed failure here would fail open.
   */
  appDid(): Promise<string | null>;
  now(): number;
}

export interface ResolveOptions {
  /**
   * A guest invited to several changes holds one invite per change. Pass the
   * change being acted on to get that invite in `member.guest` (CAPABILITIES
   * only ever look at one invite). Without it the first valid invite is used.
   */
  changeId?: string;
}

export interface Membership {
  /**
   * The member, or null (refused). Throws MembershipUnavailableError when the
   * lookup failed and no cached verdict is still valid: callers must refuse.
   */
  resolve(address: string, opts?: ResolveOptions): Promise<Member | null>;
  /**
   * The org role only, ignoring team state. Not cached (each call looks the
   * org role up); same failure behaviour as resolve.
   */
  resolveBase(address: string): Promise<{ role: StudioRoleName; name: string | null } | null>;
  invalidate(address?: string): void;
}

export function createMembership(deps: MembershipDeps): Membership {
  const cache = new Map<string, { verdict: Member | null; expiresAt: number }>();
  // Bumped by invalidate(): a lookup that started before it must not write
  // its (possibly stale) verdict afterwards.
  let globalGen = 0;
  const addressGen = new Map<string, number>();
  const genOf = (addr: string) => `${globalGen}:${addressGen.get(addr) ?? 0}`;

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

  async function compute(addr: string, changeId: string | undefined): Promise<Member | null> {
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
    const valid = team.guests.filter(
      (g) => same(g.address) && !g.revokedAt && Date.parse(g.expiresAt) > now,
    );
    const guest = valid.find((g) => g.changeId === changeId) ?? valid[0];
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
    async resolve(address, opts = {}) {
      const addr = address.toLowerCase();
      const key = `${addr}|${opts.changeId ?? ""}`;
      const hit = cache.get(key);
      if (
        hit &&
        hit.expiresAt > deps.now() &&
        // a guest verdict never outlives the invite
        (!hit.verdict?.guest || Date.parse(hit.verdict.guest.expiresAt) > deps.now())
      ) {
        return hit.verdict;
      }
      const gen = genOf(addr);
      const verdict = await compute(addr, opts.changeId);
      if (genOf(addr) === gen) {
        let expiresAt = deps.now() + (verdict ? MEMBERSHIP_TTL_MS : REFUSAL_TTL_MS);
        if (verdict?.guest) expiresAt = Math.min(expiresAt, Date.parse(verdict.guest.expiresAt));
        cache.set(key, { verdict, expiresAt });
      }
      return verdict;
    },
    resolveBase,
    invalidate(address) {
      if (address === undefined) {
        globalGen++;
        cache.clear();
        return;
      }
      const addr = address.toLowerCase();
      addressGen.set(addr, (addressGen.get(addr) ?? 0) + 1);
      for (const key of cache.keys()) if (key.startsWith(`${addr}|`)) cache.delete(key);
    },
  };
}

function unavailable(err: unknown): MembershipUnavailableError {
  if (err instanceof MembershipUnavailableError) return err;
  return new MembershipUnavailableError(
    `membership lookup failed: ${err instanceof Error ? err.name : "unknown error"}`,
  );
}
