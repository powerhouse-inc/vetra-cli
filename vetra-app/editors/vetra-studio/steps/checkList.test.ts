import { actions } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import { checkList } from "./checkList.js";

describe("checkList", () => {
  it("shows the latest result per check with its plain reason", () => {
    const doc = productDoc(
      ...buildingOps(),
      actions.recordCheckRun({
        changeId: "c1",
        id: "r1",
        at: at(5),
        results: [
          { kind: "GENERATE", passed: true },
          {
            kind: "TYPECHECK",
            passed: false,
            reason: "a date is used as text",
          },
          { kind: "LINT", passed: false, reason: "2 unused names" },
        ],
      }),
      actions.recordCheckRun({
        changeId: "c1",
        id: "r2",
        at: at(6),
        results: [{ kind: "TYPECHECK", passed: true }],
      }),
      actions.waiveLint({ changeId: "c1", at: at(7) }),
    );
    const change = readProduct(doc.state.global).changes[0];
    expect(
      checkList(change).map(({ kind, status, reason }) => ({
        kind,
        status,
        reason,
      })),
    ).toEqual([
      { kind: "GENERATE", status: "passed", reason: null },
      { kind: "TYPECHECK", status: "passed", reason: null },
      { kind: "LINT", status: "waived", reason: "2 unused names" },
      { kind: "REDUCER_TESTS", status: "not-run", reason: null },
      { kind: "SMOKE", status: "not-run", reason: null },
    ]);
  });

  it("no change: every check not run yet", () => {
    expect(checkList(null).every((c) => c.status === "not-run")).toBe(true);
  });
});
