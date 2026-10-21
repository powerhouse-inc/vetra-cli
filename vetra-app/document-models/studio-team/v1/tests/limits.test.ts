import {
  clearMemberLimit,
  setMemberLimit,
  utils,
} from "document-models/studio-team/v1";
import { describe, expect, it } from "vitest";
import { ALICE, apply, at, BOB, errorAt } from "./helpers.js";

describe("limits module", () => {
  it("SET_MEMBER_LIMIT stores and replaces a lowercase-keyed limit", () => {
    const doc = apply(
      utils.createDocument(),
      setMemberLimit({ address: ALICE, monthlyUsd: 50, at: at(0) }),
      setMemberLimit({
        address: ALICE.toLowerCase(),
        monthlyUsd: 0,
        at: at(1),
      }),
      setMemberLimit({ address: BOB, monthlyUsd: 10.5, at: at(2) }),
    );
    expect(doc.state.global.memberLimits).toEqual([
      { address: ALICE.toLowerCase(), monthlyUsd: 0, at: at(1) },
      { address: BOB.toLowerCase(), monthlyUsd: 10.5, at: at(2) },
    ]);
  });

  it("SET_MEMBER_LIMIT negative returns InvalidLimitError", () => {
    const doc = apply(
      utils.createDocument(),
      setMemberLimit({ address: ALICE, monthlyUsd: -1, at: at(0) }),
    );
    expect(errorAt(doc, 0)).toBe("The limit cannot be negative.");
    expect(doc.state.global.memberLimits).toEqual([]);
  });

  it("CLEAR_MEMBER_LIMIT removes the limit, unknown address is a no-op", () => {
    const doc = apply(
      utils.createDocument(),
      setMemberLimit({ address: ALICE, monthlyUsd: 5, at: at(0) }),
      clearMemberLimit({ address: ALICE.toUpperCase().replace("0X", "0x") }),
      clearMemberLimit({ address: BOB }),
    );
    expect(errorAt(doc, 1)).toBeNull();
    expect(errorAt(doc, 2)).toBeNull();
    expect(doc.state.global.memberLimits).toEqual([]);
  });
});
