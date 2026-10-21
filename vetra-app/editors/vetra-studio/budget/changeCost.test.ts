import { describe, expect, it } from "vitest";
import type { StudioProductState } from "document-models/studio-product";
import { changeCostUsd, costActions } from "./changeCost.js";

function product(
  status: string,
  cost: { startUsd?: number; endUsd?: number } | null,
  active = true,
): StudioProductState {
  return {
    activeChangeId: active ? "c1" : null,
    changes: [
      {
        id: "c1",
        status,
        cost: cost && { startUsd: null, endUsd: null, ...cost },
      },
    ],
  } as unknown as StudioProductState;
}

const input = (a: { input: unknown }) => a.input;

describe("costActions", () => {
  it("start recorded when a change begins", () => {
    const out = costActions(product("BUILDING", null), 1.5, 0);
    expect(out.map(input)).toEqual([{ changeId: "c1", startUsd: 1.5 }]);
    expect(costActions(product("BUILDING", { startUsd: 1.5 }), 2, 0)).toEqual(
      [],
    );
  });
  it("end recorded when it is ready", () => {
    const out = costActions(product("READY", { startUsd: 1 }, false), 3, 0);
    expect(out.map(input)).toEqual([{ changeId: "c1", endUsd: 3 }]);
    expect(
      costActions(product("READY", { startUsd: 1, endUsd: 3 }, false), 4, 0),
    ).toEqual([]);
    expect(costActions(product("BUILDING", { startUsd: 1 }), 4, 0)).toEqual([]);
  });
  it("unknown usage records nothing", () => {
    expect(costActions(product("BUILDING", null), null, 0)).toEqual([]);
    expect(
      costActions(product("READY", { startUsd: 1 }, false), null, 0),
    ).toEqual([]);
  });
  it("negative difference counts as zero", () => {
    const p = product("READY", { startUsd: 5, endUsd: 2 }, false);
    expect(changeCostUsd(p.changes[0])).toBe(0);
    expect(
      changeCostUsd(product("READY", { startUsd: 1, endUsd: 4 }).changes[0]),
    ).toBe(3);
    expect(
      changeCostUsd(product("READY", { startUsd: 1 }).changes[0]),
    ).toBeNull();
  });
});
