import {
  addReviewer,
  initTeam,
  inviteGuest,
  revokeGuest,
  setMemberLimit,
  setRoleOverride,
  utils,
} from "document-models/studio-team/v1";
import { describe, expect, it } from "vitest";
import { ALICE, apply, at, BOB, errorAt, plusDays } from "./helpers.js";

describe("team scenario", () => {
  it("team: init -> reviewer -> override -> guest -> revoke -> limit", () => {
    const doc = apply(
      utils.createDocument(),
      initTeam({ orgId: "acme-bau", reviewRequired: true, at: at(0) }),
      addReviewer({ address: ALICE, name: "Alice", at: at(1) }),
      setRoleOverride({ address: BOB, role: "VIEWER", at: at(2) }),
      inviteGuest({
        id: "g1",
        address: BOB,
        changeId: "c1",
        rights: "COMMENT_STEER",
        expiresAt: plusDays(3, 14),
        invitedAt: at(3),
      }),
      revokeGuest({ id: "g1", at: at(4) }),
      setMemberLimit({ address: ALICE, monthlyUsd: 120, at: at(5) }),
    );
    for (let i = 0; i < 6; i++) expect(errorAt(doc, i)).toBeNull();
    expect(doc.state.global).toEqual({
      initialized: true,
      orgId: "acme-bau",
      reviewRequired: true,
      reviewers: [
        { address: ALICE.toLowerCase(), name: "Alice", addedAt: at(1) },
      ],
      roleOverrides: [
        { address: BOB.toLowerCase(), role: "VIEWER", at: at(2) },
      ],
      guests: [
        {
          id: "g1",
          address: BOB.toLowerCase(),
          name: null,
          changeId: "c1",
          rights: "COMMENT_STEER",
          expiresAt: plusDays(3, 14),
          invitedAt: at(3),
          revokedAt: at(4),
        },
      ],
      memberLimits: [
        { address: ALICE.toLowerCase(), monthlyUsd: 120, at: at(5) },
      ],
    });
  });
});
