import { describe, expect, it } from "vitest";
import type { Member } from "./capabilities.js";
import {
  ROLE_NAMES,
  can,
  canLaunch,
  canManageTeam,
  canSteer,
  limitedToWatching,
} from "./roleGate.js";

const OWNER: Member = {
  address: "0xaa",
  name: "Ada",
  role: "owner",
  reviewer: false,
};
const MAKER: Member = {
  address: "0xbb",
  name: "Mo",
  role: "maker",
  reviewer: false,
};
const VIEWER: Member = {
  address: "0xcc",
  name: "Vi",
  role: "viewer",
  reviewer: false,
};
const GUEST: Member = {
  address: "0xdd",
  name: "Gil",
  role: "guest",
  reviewer: false,
  guest: {
    id: "g1",
    changeId: "c1",
    rights: "COMMENT_STEER",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

describe("role gates", () => {
  it("names the roles the Studio writes", () => {
    expect(ROLE_NAMES).toEqual({
      owner: "Owner",
      maker: "Maker",
      viewer: "Viewer",
      guest: "Guest",
    });
  });

  it("an Owner and a Maker steer and launch; a Viewer does neither", () => {
    for (const me of [OWNER, MAKER]) {
      expect(canSteer(me)).toBe(true);
      expect(canLaunch(me)).toBe(true);
    }
    expect(canSteer(VIEWER)).toBe(false);
    expect(canLaunch(VIEWER)).toBe(false);
    expect(can(VIEWER, "comment")).toBe(true);
    expect(can(VIEWER, "manageTeam")).toBe(false);
    expect(canManageTeam(VIEWER)).toBe(false);
  });

  it("only an Owner manages the team", () => {
    expect(canManageTeam(OWNER)).toBe(true);
    expect(canManageTeam(MAKER)).toBe(false);
  });

  it("a guest steers only their own change", () => {
    expect(canSteer(GUEST, { changeId: "c1" })).toBe(true);
    expect(canSteer(GUEST, { changeId: "c2" })).toBe(false);
    expect(can(GUEST, "view", { changeId: "c1" })).toBe(true);
    expect(can(GUEST, "view", { changeId: "c2" })).toBe(false);
  });

  it("no team information never gates (the server still enforces)", () => {
    expect(canSteer(null)).toBe(true);
    expect(canLaunch(null)).toBe(true);
    expect(canManageTeam(null)).toBe(true);
  });

  it("an override or the viewer role means watching only", () => {
    expect(limitedToWatching({ role: "maker", overridden: true })).toBe(true);
    expect(limitedToWatching({ role: "viewer" })).toBe(true);
    expect(limitedToWatching({ role: "maker", overridden: false })).toBe(false);
  });
});
