import { describe, expect, it, jest } from "@jest/globals";
import type { StudioTeamState } from "vetra-app/document-models/studio-team";

import { createMembership, MembershipUnavailableError } from "../../src/team/membership.js";
import type { OrgMembership } from "../../src/team/renown-orgs.js";

const A = "0xaaaa000000000000000000000000000000000001";
const B = "0xbbbb000000000000000000000000000000000002";
const NOW = Date.parse("2026-10-21T12:00:00.000Z");

const team = (p: Partial<StudioTeamState> = {}): StudioTeamState => ({
  guests: [], initialized: true, memberLimits: [], orgId: "acme", reviewRequired: false,
  reviewers: [], roleOverrides: [], ...p,
});

const org = (role: OrgMembership["role"], over: Partial<OrgMembership> = {}): OrgMembership => ({
  role, status: "ACTIVE", effectiveScope: { all: true, appDids: [] }, ...over,
});

function setup(opts: {
  orgId?: string | null;
  admins?: string;
  orgs?: Record<string, OrgMembership | null>;
  team?: StudioTeamState;
  appDid?: string | null;
} = {}) {
  const clock = { t: NOW };
  const orgs = opts.orgs ?? {};
  const fetchOrgMembership = jest.fn(async (_org: string, address: string) => orgs[address.toLowerCase()] ?? null);
  const state = { team: opts.team ?? team() };
  const m = createMembership({
    orgId: opts.orgId === undefined ? "acme" : opts.orgId,
    admins: opts.admins ?? "",
    fetchOrgMembership,
    acceptedTeam: async () => state.team,
    appDid: async () => (opts.appDid === undefined ? null : opts.appDid),
    now: () => clock.t,
  });
  return { m, clock, fetchOrgMembership, orgs, state };
}

describe("membership (org Studio)", () => {
  it("org roles map to Studio roles", async () => {
    const { m } = setup({ orgs: { [A]: org("ADMIN"), [B]: org("MEMBER") } });
    expect((await m.resolve(A))?.role).toBe("owner");
    expect((await m.resolve(B))?.role).toBe("viewer");
    expect(await m.resolve("0xcccc000000000000000000000000000000000003")).toBeNull();
  });

  it("a publisher is a maker only when scoped to the Studio app", async () => {
    const scoped = org("PUBLISHER", { effectiveScope: { all: false, appDids: ["did:app"] } });
    const a = setup({ orgs: { [A]: scoped }, appDid: "did:app" });
    expect((await a.m.resolve(A))?.role).toBe("maker");
    const b = setup({ orgs: { [A]: scoped }, appDid: "did:other" });
    expect((await b.m.resolve(A))?.role).toBe("viewer");
    const c = setup({ orgs: { [A]: scoped }, appDid: null });
    expect((await c.m.resolve(A))?.role).toBe("maker");
  });

  it("an inactive membership is no member", async () => {
    const { m } = setup({ orgs: { [A]: org("OWNER", { status: "REMOVED" }) } });
    expect(await m.resolve(A)).toBeNull();
  });

  it("addresses are case-insensitive", async () => {
    const { m } = setup({ orgs: { [A]: org("OWNER") } });
    expect((await m.resolve(A.toUpperCase().replace("0X", "0x")))?.address).toBe(A);
  });

  it("override can lower a maker to viewer", async () => {
    const { m } = setup({
      orgs: { [A]: org("PUBLISHER") },
      team: team({ roleOverrides: [{ address: A, at: "x", role: "VIEWER" }] }),
    });
    expect((await m.resolve(A))?.role).toBe("viewer");
  });

  it("override to owner is ignored", async () => {
    const { m } = setup({
      orgs: { [A]: org("PUBLISHER"), [B]: org("MEMBER") },
      team: team({ roleOverrides: [
        { address: A, at: "x", role: "OWNER" },
        { address: B, at: "x", role: "MAKER" },
      ] }),
    });
    expect((await m.resolve(A))?.role).toBe("maker");
    expect((await m.resolve(B))?.role).toBe("viewer");
  });

  it("an override never lowers an owner", async () => {
    const { m } = setup({
      orgs: { [A]: org("OWNER") },
      team: team({ roleOverrides: [{ address: A, at: "x", role: "VIEWER" }] }),
    });
    expect((await m.resolve(A))?.role).toBe("owner");
  });

  it("unaccepted reviewer operation grants nothing", async () => {
    // acceptedTeam() is filtered by the trust ledger: an unaccepted
    // ADD_REVIEWER is simply absent from it.
    const { m } = setup({ orgs: { [A]: org("MEMBER") }, team: team({ reviewers: [] }) });
    expect((await m.resolve(A))?.reviewer).toBe(false);
  });

  it("accepted reviewer flag sits on top of the base role; a non-member reviewer gets nothing", async () => {
    const person = { address: A, addedAt: "x", name: "Ada" };
    const { m } = setup({
      orgs: { [A]: org("MEMBER") },
      team: team({ reviewers: [person, { address: B, addedAt: "x", name: null }] }),
    });
    const got = await m.resolve(A);
    expect(got).toMatchObject({ role: "viewer", reviewer: true, name: "Ada" });
    expect(await m.resolve(B)).toBeNull();
  });

  it("guests: accepted, not revoked, unexpired, only their change", async () => {
    const g = (id: string, over: object = {}) => ({
      id, address: A, changeId: "c1", rights: "COMMENT_STEER" as const, name: "Gus",
      invitedAt: "x", expiresAt: "2026-10-22T00:00:00.000Z", revokedAt: null, ...over,
    });
    const ok = setup({ team: team({ guests: [g("g1")] }) });
    expect(await ok.m.resolve(A)).toMatchObject({
      role: "guest", name: "Gus", reviewer: false,
      guest: { id: "g1", changeId: "c1", rights: "COMMENT_STEER" },
    });
    const revoked = setup({ team: team({ guests: [g("g1", { revokedAt: "y" })] }) });
    expect(await revoked.m.resolve(A)).toBeNull();
    const expired = setup({ team: team({ guests: [g("g1", { expiresAt: "2026-10-21T11:59:59.000Z" })] }) });
    expect(await expired.m.resolve(A)).toBeNull();
    const garbage = setup({ team: team({ guests: [g("g1", { expiresAt: "not a date" })] }) });
    expect(await garbage.m.resolve(A)).toBeNull();
    const second = setup({ team: team({ guests: [g("g1", { revokedAt: "y" }), g("g2")] }) });
    expect((await second.m.resolve(A))?.guest?.id).toBe("g2");
  });

  it("an org member who is also a guest keeps the org role", async () => {
    const { m } = setup({
      orgs: { [A]: org("MEMBER") },
      team: team({ guests: [{ id: "g", address: A, changeId: "c", rights: "COMMENT", name: null, invitedAt: "x", expiresAt: "2099-01-01T00:00:00.000Z", revokedAt: null }] }),
    });
    expect((await m.resolve(A))?.role).toBe("viewer");
  });

  it("resolveBase uses the org role only", async () => {
    const { m, state } = setup({
      orgs: { [A]: org("PUBLISHER") },
      team: team({ roleOverrides: [{ address: A, at: "x", role: "VIEWER" }] }),
    });
    expect(await m.resolveBase(A)).toEqual({ role: "maker", name: null });
    expect(await m.resolveBase(B)).toBeNull();
    expect(state.team.roleOverrides).toHaveLength(1);
  });
});

describe("membership cache", () => {
  it("a removed member is refused after the cache expires", async () => {
    const { m, clock, orgs, fetchOrgMembership } = setup({ orgs: { [A]: org("OWNER") } });
    expect((await m.resolve(A))?.role).toBe("owner");
    orgs[A] = null;
    clock.t += 59_000;
    expect((await m.resolve(A))?.role).toBe("owner");
    expect(fetchOrgMembership).toHaveBeenCalledTimes(1);
    clock.t += 2_000;
    expect(await m.resolve(A)).toBeNull();
    expect(fetchOrgMembership).toHaveBeenCalledTimes(2);
  });

  it("refusals are cached for 15 s only", async () => {
    const { m, clock, orgs, fetchOrgMembership } = setup();
    expect(await m.resolve(A)).toBeNull();
    orgs[A] = org("OWNER");
    clock.t += 14_000;
    expect(await m.resolve(A)).toBeNull();
    expect(fetchOrgMembership).toHaveBeenCalledTimes(1);
    clock.t += 2_000;
    expect((await m.resolve(A))?.role).toBe("owner");
  });

  it("invalidate drops one address or all", async () => {
    const { m, orgs, fetchOrgMembership } = setup({ orgs: { [A]: org("OWNER"), [B]: org("OWNER") } });
    await m.resolve(A); await m.resolve(B);
    orgs[A] = null; orgs[B] = null;
    m.invalidate(A.toUpperCase().replace("0X", "0x"));
    expect(await m.resolve(A)).toBeNull();
    expect((await m.resolve(B))?.role).toBe("owner");
    m.invalidate();
    expect(await m.resolve(B)).toBeNull();
    expect(fetchOrgMembership).toHaveBeenCalledTimes(4);
  });

  it("orgs service down: cached member keeps access until TTL, unknown member refused", async () => {
    const { m, clock, fetchOrgMembership } = setup({ orgs: { [A]: org("OWNER") } });
    await m.resolve(A);
    fetchOrgMembership.mockImplementation(async () => { throw new Error("down"); });
    clock.t += 30_000;
    expect((await m.resolve(A))?.role).toBe("owner"); // within TTL: cache, no lookup
    await expect(m.resolve(B)).rejects.toBeInstanceOf(MembershipUnavailableError);
    clock.t += 31_000; // A is past its TTL and the lookup fails: no grace period
    await expect(m.resolve(A)).rejects.toBeInstanceOf(MembershipUnavailableError);
    // a failure is never cached as a verdict
    fetchOrgMembership.mockImplementation(async () => org("OWNER"));
    expect((await m.resolve(B))?.role).toBe("owner");
  });

  it("a team-state failure fails closed too", async () => {
    const f = jest.fn(async () => org("OWNER"));
    const m = createMembership({
      orgId: "acme", admins: "", fetchOrgMembership: f,
      acceptedTeam: async () => { throw new Error("ledger"); },
      appDid: async () => null, now: () => NOW,
    });
    await expect(m.resolve(A)).rejects.toBeInstanceOf(MembershipUnavailableError);
  });
});

describe("personal Studio", () => {
  it("personal Studio: only ADMINS is a member", async () => {
    const { m, fetchOrgMembership } = setup({ orgId: null, admins: `${A.toUpperCase().replace("0X", "0x")}, 0xdddd000000000000000000000000000000000004`, orgs: { [B]: org("OWNER") } });
    expect(await m.resolve(A)).toEqual({ address: A, name: null, role: "owner", reviewer: false });
    expect(await m.resolve(B)).toBeNull();
    expect(await m.resolveBase(A)).toEqual({ role: "owner", name: null });
    expect(await m.resolveBase(B)).toBeNull();
    expect(fetchOrgMembership).not.toHaveBeenCalled();
  });
});
