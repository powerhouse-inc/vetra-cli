import {
  addReviewer,
  clearRoleOverride,
  initTeam,
  removeReviewer,
  setReviewRequired,
  setRoleOverride,
  utils,
} from "document-models/studio-team/v1";
import { describe, expect, it } from "vitest";
import { ALICE, apply, at, BOB, errorAt } from "./helpers.js";

describe("team module", () => {
  it("starts empty with the documented defaults", () => {
    expect(utils.createDocument().state.global).toMatchObject({
      initialized: false,
      orgId: null,
      reviewRequired: false,
      reviewers: [],
      roleOverrides: [],
      guests: [],
      memberLimits: [],
    });
  });

  it("INIT_TEAM stores org and review flag", () => {
    const doc = apply(
      utils.createDocument(),
      initTeam({ orgId: "acme-bau", reviewRequired: true, at: at(0) }),
    );
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.orgId).toBe("acme-bau");
    expect(doc.state.global.reviewRequired).toBe(true);
  });

  it("INIT_TEAM twice returns TeamAlreadyInitializedError and keeps state", () => {
    const doc = apply(
      utils.createDocument(),
      initTeam({ orgId: "acme-bau", reviewRequired: true, at: at(0) }),
      initTeam({ orgId: "other", reviewRequired: false, at: at(1) }),
    );
    expect(errorAt(doc, 1)).toBe("The team was already initialised.");
    expect(doc.state.global.orgId).toBe("acme-bau");
    expect(doc.state.global.reviewRequired).toBe(true);
  });

  it("INIT_TEAM with a null org initialises a personal team; a second init errors", () => {
    const doc = apply(
      utils.createDocument(),
      initTeam({ orgId: null, reviewRequired: false, at: at(0) }),
      initTeam({ orgId: "acme-bau", reviewRequired: true, at: at(1) }),
    );
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.initialized).toBe(true);
    expect(doc.state.global.orgId).toBeNull();
    expect(errorAt(doc, 1)).toBe("The team was already initialised.");
    expect(doc.state.global.orgId).toBeNull();
    expect(doc.state.global.reviewRequired).toBe(false);
  });

  it("SET_REVIEW_REQUIRED toggles the flag", () => {
    const doc = apply(
      utils.createDocument(),
      setReviewRequired({ required: true, at: at(0) }),
      setReviewRequired({ required: false, at: at(1) }),
    );
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.reviewRequired).toBe(false);
  });

  it("ADD_REVIEWER adds a reviewer; REMOVE_REVIEWER removes it", () => {
    let doc = apply(
      utils.createDocument(),
      addReviewer({ address: ALICE, name: "Alice", at: at(0) }),
      addReviewer({ address: BOB, at: at(1) }),
    );
    expect(doc.state.global.reviewers).toEqual([
      { address: ALICE.toLowerCase(), name: "Alice", addedAt: at(0) },
      { address: BOB.toLowerCase(), name: null, addedAt: at(1) },
    ]);
    doc = apply(doc, removeReviewer({ address: ALICE }));
    expect(errorAt(doc, 2)).toBeNull();
    expect(doc.state.global.reviewers.map((r) => r.address)).toEqual([
      BOB.toLowerCase(),
    ]);
  });

  it("ADD_REVIEWER twice (any casing) returns DuplicateReviewerError", () => {
    const doc = apply(
      utils.createDocument(),
      addReviewer({ address: ALICE, at: at(0) }),
      addReviewer({ address: ALICE.toLowerCase(), at: at(1) }),
    );
    expect(errorAt(doc, 1)).toBe("This address is already a reviewer.");
    expect(doc.state.global.reviewers).toHaveLength(1);
  });

  it("REMOVE_REVIEWER of an unknown address returns ReviewerNotFoundError", () => {
    const doc = apply(
      utils.createDocument(),
      removeReviewer({ address: ALICE }),
    );
    expect(errorAt(doc, 0)).toBe("No reviewer with this address.");
  });

  it("SET_ROLE_OVERRIDE sets and replaces; CLEAR_ROLE_OVERRIDE clears", () => {
    let doc = apply(
      utils.createDocument(),
      setRoleOverride({ address: ALICE, role: "VIEWER", at: at(0) }),
      setRoleOverride({
        address: ALICE.toLowerCase(),
        role: "MAKER",
        at: at(1),
      }),
      setRoleOverride({ address: BOB, role: "VIEWER", at: at(2) }),
    );
    expect(doc.state.global.roleOverrides).toEqual([
      { address: ALICE.toLowerCase(), role: "MAKER", at: at(1) },
      { address: BOB.toLowerCase(), role: "VIEWER", at: at(2) },
    ]);
    doc = apply(doc, clearRoleOverride({ address: ALICE }));
    expect(doc.state.global.roleOverrides.map((o) => o.address)).toEqual([
      BOB.toLowerCase(),
    ]);
  });

  it("SET_ROLE_OVERRIDE to OWNER returns InvalidOverrideError", () => {
    const doc = apply(
      utils.createDocument(),
      setRoleOverride({ address: ALICE, role: "OWNER", at: at(0) }),
    );
    expect(errorAt(doc, 0)).toBe(
      "OWNER cannot be granted through an override.",
    );
    expect(doc.state.global.roleOverrides).toEqual([]);
  });

  it("CLEAR_ROLE_OVERRIDE of an unknown address is a no-op", () => {
    const doc = apply(
      utils.createDocument(),
      clearRoleOverride({ address: ALICE }),
    );
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.roleOverrides).toEqual([]);
  });

  it("addresses are stored lowercase", () => {
    const doc = apply(
      utils.createDocument(),
      addReviewer({ address: ALICE, at: at(0) }),
      setRoleOverride({ address: BOB, role: "VIEWER", at: at(1) }),
    );
    expect(doc.state.global.reviewers[0].address).toBe(ALICE.toLowerCase());
    expect(doc.state.global.roleOverrides[0].address).toBe(BOB.toLowerCase());
  });
});
