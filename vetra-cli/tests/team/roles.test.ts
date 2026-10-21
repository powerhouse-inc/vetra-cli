import { describe, expect, it } from "@jest/globals";

import {
  CAPABILITIES,
  mapOrgRole,
  publisherCapable,
  type Capability,
  type Member,
  type StudioRoleName,
} from "../../src/team/roles.js";

const ADDR = "0xaaaa000000000000000000000000000000000001";
const OTHER = "0xbbbb000000000000000000000000000000000002";

function member(role: StudioRoleName, extra: Partial<Member> = {}): Member {
  return { address: ADDR, name: null, role, reviewer: false, ...extra };
}
const guest = (rights: "COMMENT" | "COMMENT_STEER") =>
  member("guest", {
    guest: { id: "g1", changeId: "c1", rights, expiresAt: "2099-01-01T00:00:00.000Z" },
  });

describe("mapOrgRole", () => {
  it("org roles map to Studio roles", () => {
    const m = (role: "OWNER" | "ADMIN" | "PUBLISHER" | "MEMBER", publisherCapable: boolean, status = "ACTIVE") =>
      mapOrgRole({ role, status, publisherCapable });
    expect(m("OWNER", true)).toBe("owner");
    expect(m("ADMIN", true)).toBe("owner");
    expect(m("PUBLISHER", true)).toBe("maker");
    expect(m("PUBLISHER", false)).toBe("viewer");
    expect(m("MEMBER", false)).toBe("viewer");
    expect(m("MEMBER", true)).toBe("viewer");
    expect(m("OWNER", true, "INVITED")).toBeNull();
    expect(m("ADMIN", true, "REMOVED")).toBeNull();
  });
});

describe("publisherCapable (cloud rule)", () => {
  const scope = (all: boolean, appDids: string[] = []) => ({ all, appDids });
  it("owner/admin always; publisher by scope", () => {
    expect(publisherCapable({ role: "OWNER", effectiveScope: scope(false) }, "did:x")).toBe(true);
    expect(publisherCapable({ role: "ADMIN", effectiveScope: scope(false) }, "did:x")).toBe(true);
    expect(publisherCapable({ role: "PUBLISHER", effectiveScope: scope(false) }, null)).toBe(true);
    expect(publisherCapable({ role: "PUBLISHER", effectiveScope: scope(true) }, "did:x")).toBe(true);
    expect(publisherCapable({ role: "PUBLISHER", effectiveScope: scope(false, ["did:x"]) }, "did:x")).toBe(true);
    expect(publisherCapable({ role: "PUBLISHER", effectiveScope: scope(false, ["did:y"]) }, "did:x")).toBe(false);
    expect(publisherCapable({ role: "MEMBER", effectiveScope: scope(true) }, null)).toBe(false);
  });
});

describe("CAPABILITIES", () => {
  const own = { changeOwner: ADDR, changeId: "c1" };
  const foreign = { changeOwner: OTHER, changeId: "c1" };
  const otherChange = { changeOwner: ADDR, changeId: "c2" };

  // [capability, owner, maker, viewer, guestComment(on c1), guestSteer(on c1), ctx]
  const rows: [Capability, boolean, boolean, boolean, boolean, boolean][] = [
    ["view", true, true, true, true, true],
    ["comment", true, true, true, true, true],
    ["steer", true, true, false, false, true],
    ["startChange", true, true, false, false, false],
    ["launch", true, true, false, false, false],
    ["requestReview", true, true, false, false, false],
    ["approve", false, false, false, false, false],
    ["triage", true, false, false, false, false],
    ["manageTeam", true, false, false, false, false],
    ["adopt", true, false, false, false, false],
    ["exportWorkspace", true, false, false, false, false],
    ["restart", true, false, false, false, false],
    ["allowAgent", true, true, false, false, false],
    ["auditExport", true, false, false, false, false],
    ["budgetBreakdown", true, false, false, false, false],
  ];

  it.each(rows)("%s matrix", (cap, owner, maker, viewer, gc, gs) => {
    const can = (m: Member) => CAPABILITIES[cap](m, own);
    expect(can(member("owner"))).toBe(owner);
    expect(can(member("maker"))).toBe(maker);
    expect(can(member("viewer"))).toBe(viewer);
    expect(can(guest("COMMENT"))).toBe(gc);
    expect(can(guest("COMMENT_STEER"))).toBe(gs);
  });

  it("covers every capability", () => {
    expect(rows.map((r) => r[0]).sort()).toEqual(Object.keys(CAPABILITIES).sort());
  });

  it("steer needs ownership of the change for owner/maker", () => {
    expect(CAPABILITIES.steer(member("maker"), foreign)).toBe(false);
    expect(CAPABILITIES.steer(member("owner"), foreign)).toBe(false);
    expect(CAPABILITIES.steer(member("maker"), {})).toBe(false);
    expect(CAPABILITIES.steer(member("maker", { address: ADDR.toUpperCase().replace("0X", "0x") }), own)).toBe(true);
  });

  it("guests are confined to their own change", () => {
    for (const cap of ["view", "comment", "steer"] as const) {
      expect(CAPABILITIES[cap](guest("COMMENT_STEER"), otherChange)).toBe(false);
      expect(CAPABILITIES[cap](guest("COMMENT_STEER"), {})).toBe(false);
    }
    expect(CAPABILITIES.view(member("guest"), own)).toBe(false);
  });

  it("approve follows the reviewer flag, never for guests", () => {
    expect(CAPABILITIES.approve(member("viewer", { reviewer: true }), own)).toBe(true);
    expect(CAPABILITIES.approve(member("owner", { reviewer: true }), own)).toBe(true);
    expect(CAPABILITIES.approve(member("guest", { reviewer: true }), own)).toBe(false);
  });
});
