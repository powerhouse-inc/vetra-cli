import type { StudioTeamState } from "document-models/studio-team/v1";
import { normalizeTeam } from "document-models/studio-team/v1";
import { describe, expect, it } from "vitest";

describe("normalizeTeam", () => {
  it("gives an old, empty document every list and default", () => {
    const old = {} as StudioTeamState;
    expect(normalizeTeam(old)).toEqual({
      orgId: null,
      reviewRequired: false,
      reviewers: [],
      roleOverrides: [],
      guests: [],
      memberLimits: [],
    });
  });

  it("keeps present values and defaults a guest's revokedAt and name", () => {
    const state = {
      orgId: "acme-bau",
      reviewRequired: true,
      reviewers: [],
      roleOverrides: [],
      guests: [{ id: "g1" }],
      memberLimits: [],
    } as unknown as StudioTeamState;
    const out = normalizeTeam(state);
    expect(out.orgId).toBe("acme-bau");
    expect(out.reviewRequired).toBe(true);
    expect(out.guests[0]).toMatchObject({
      id: "g1",
      name: null,
      revokedAt: null,
    });
  });
});
