import {
  inviteGuest,
  revokeGuest,
  utils,
} from "document-models/studio-team/v1";
import { describe, expect, it } from "vitest";
import { ALICE, apply, at, errorAt, plusDays } from "./helpers.js";

function invite(
  id: string,
  expiresAt: string,
  invitedAt = at(0),
  address = ALICE,
) {
  return inviteGuest({
    id,
    address,
    name: "Guest",
    changeId: "c1",
    rights: "COMMENT",
    expiresAt,
    invitedAt,
  });
}

describe("guests module", () => {
  it("INVITE_GUEST stores a lowercase guest with no revocation", () => {
    const doc = apply(utils.createDocument(), invite("g1", plusDays(0, 7)));
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.guests).toEqual([
      {
        id: "g1",
        address: ALICE.toLowerCase(),
        name: "Guest",
        changeId: "c1",
        rights: "COMMENT",
        expiresAt: plusDays(0, 7),
        invitedAt: at(0),
        revokedAt: null,
      },
    ]);
  });

  it("INVITE_GUEST without a name stores null", () => {
    const doc = apply(
      utils.createDocument(),
      inviteGuest({
        id: "g1",
        address: ALICE,
        changeId: "c1",
        rights: "COMMENT_STEER",
        expiresAt: plusDays(0, 1),
        invitedAt: at(0),
      }),
    );
    expect(doc.state.global.guests[0].name).toBeNull();
    expect(doc.state.global.guests[0].rights).toBe("COMMENT_STEER");
  });

  it("INVITE_GUEST accepts exactly 30 days", () => {
    const doc = apply(utils.createDocument(), invite("g1", plusDays(0, 30)));
    expect(errorAt(doc, 0)).toBeNull();
  });

  it("INVITE_GUEST with a duplicate id returns DuplicateGuestError", () => {
    const doc = apply(
      utils.createDocument(),
      invite("g1", plusDays(0, 7)),
      invite("g1", plusDays(0, 8)),
    );
    expect(errorAt(doc, 1)).toBe("A guest with this id already exists.");
    expect(doc.state.global.guests).toHaveLength(1);
  });

  it.each([
    ["equal to invitedAt", at(0)],
    ["before invitedAt", plusDays(0, -1)],
    ["30 days and 1 ms", plusDays(0, 30, 1)],
  ])(
    "INVITE_GUEST with expiry %s returns InvalidGuestExpiryError",
    (_n, exp) => {
      const doc = apply(utils.createDocument(), invite("g1", exp));
      expect(errorAt(doc, 0)).toBe(
        "The expiry must be after the invitation and at most 30 days later.",
      );
      expect(doc.state.global.guests).toEqual([]);
    },
  );

  it("REVOKE_GUEST marks the guest revoked and keeps the first time", () => {
    const doc = apply(
      utils.createDocument(),
      invite("g1", plusDays(0, 7)),
      revokeGuest({ id: "g1", at: at(5) }),
      revokeGuest({ id: "g1", at: at(9) }),
    );
    expect(errorAt(doc, 1)).toBeNull();
    expect(errorAt(doc, 2)).toBeNull();
    expect(doc.state.global.guests[0].revokedAt).toBe(at(5));
  });

  it("REVOKE_GUEST of an unknown id returns GuestNotFoundError", () => {
    const doc = apply(
      utils.createDocument(),
      revokeGuest({ id: "nope", at: at(0) }),
    );
    expect(errorAt(doc, 0)).toBe("No guest with this id.");
  });
});
