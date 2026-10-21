import type {
  StudioProductState,
  Version,
} from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import {
  buildingOps,
  productDoc,
  version,
} from "../test-utils/studioFixtures.js";
import {
  BUILT_BY_VETRA,
  FINISH_YOUR_CHANGE_FIRST,
  failedGoBack,
  goBackConfirmText,
  goBackDisabledReason,
  goBackOffered,
  requestFailureText,
  undoRequest,
  versionRows,
  whenText,
} from "./versionRows.js";

/** Local times, so "today 14:02" holds in any time zone. */
const NOW = new Date(2026, 9, 21, 15, 0);
const local = (day: number, h: number, m: number) =>
  new Date(2026, 9, day, h, m).toISOString();

const BLOCKED =
  "Can't go back automatically: Version 3 added data your users have already used. Ask the agent to undo the change instead.";

/** Versions 1–4 (4 live, a failed 5th), as the agent records them. */
function product(
  edit: (global: StudioProductState) => void = () => {},
): StudioProductState {
  const doc = productDoc(...buildingOps());
  const g = doc.state.global;
  doc.state.global.changes[0].status = "LAUNCHED";
  const v = (n: number, at: string, o: Partial<Version>) =>
    version(n, at, {
      status: "PREVIOUS",
      deploymentId: `dep-${n}`,
      launchedBy: "frank",
      ...o,
    });
  g.versions = [
    v(1, local(20, 9, 30), { title: "First version", launchedBy: "vetra" }),
    v(2, local(20, 11, 0), { title: "QR code on each table" }),
    v(3, local(21, 11, 40), {
      title: "Ready column",
      summary: "Adds a Ready column to the kitchen board.",
      changedFiles: ["document-models/order/schema.graphql"],
      sha: "abc123",
    }),
    v(4, local(21, 14, 2), { title: "Notes for the kitchen", status: "LIVE" }),
    v(5, local(21, 14, 30), {
      title: "Broken",
      status: "FAILED",
      failure: "the new version didn't start",
      launchedAt: null,
    }),
  ];
  g.liveVersion = 4;
  g.liveSince = local(21, 14, 2);
  g.liveUrl = "https://kitchen.vetra.io";
  edit(g);
  return readProduct(g);
}

describe("versionRows", () => {
  it("every launch is listed, newest first, live marked", () => {
    const rows = versionRows(product(), NOW);
    // F23: the failed launch is not a version.
    expect(rows.map((r) => r.number)).toEqual([4, 3, 2, 1]);
    expect(rows.map((r) => r.live)).toEqual([true, false, false, false]);
    expect(rows[0]).toMatchObject({
      title: "Notes for the kitchen",
      when: "today 14:02",
      who: "you",
      action: "none",
    });
    expect(rows[1]).toMatchObject({ when: "today 11:40", action: "go-back" });
    expect(rows[2]).toMatchObject({ when: "yesterday", who: "you" });
    // F52: the automatic first launch.
    expect(rows[3]).toMatchObject({
      title: "First version",
      who: BUILT_BY_VETRA,
      action: "go-back",
    });
    expect(rows[1].whatChanged).toEqual({
      summary: "Adds a Ready column to the kitchen board.",
      files: ["document-models/order/schema.graphql"],
    });
  });

  it("links the commit when GitHub is connected", () => {
    const rows = versionRows(
      product((g) => {
        g.github = {
          ...g.github,
          status: "CONNECTED",
          repoFullName: "acme/kitchen",
        };
      }),
      NOW,
    );
    expect(rows[1].whatChanged.commitUrl).toBe(
      "https://github.com/acme/kitchen/commit/abc123",
    );
  });

  it("go back confirmation text", () => {
    expect(goBackConfirmText(2, 4)).toBe(
      "Make Version 2 live again? Your users' documents stay as they are. Changes made after Version 2 aren't deleted — you can come back to Version 4 any time.",
    );
  });

  it("blocked row offers Undo with the agent", () => {
    const p = product((g) => {
      g.versions[1].rollbackBlockedReason = BLOCKED;
    });
    const row = versionRows(p, NOW).find((r) => r.number === 2);
    expect(row).toMatchObject({
      action: "undo-with-agent",
      blockedReason: BLOCKED,
      // Undo the change that added the data in use (Version 3), not Version 2.
      undoTitle: "Ready column",
    });
    expect(goBackOffered(p.versions[1])).toBe(false);
    expect(goBackOffered(p.versions[0])).toBe(true);
    expect(undoRequest(row?.undoTitle ?? "")).toBe(
      "Undo 'Ready column' but keep existing data",
    );
    // A sentence without a version number: the version right after it.
    const plain = product((g) => {
      g.versions[0].rollbackBlockedReason = "Your users' data needs it.";
    });
    expect(versionRows(plain, NOW).find((r) => r.number === 1)).toMatchObject({
      action: "undo-with-agent",
      undoTitle: "QR code on each table",
    });
  });

  it("go back disabled during a change", () => {
    expect(goBackDisabledReason(product())).toBeNull();
    for (const status of [
      "BUILDING",
      "PAUSED",
      "READY",
      "LAUNCHING",
    ] as const) {
      const p = product((g) => {
        g.changes[0].status = status;
      });
      expect(goBackDisabledReason(p)).toBe(FINISH_YOUR_CHANGE_FIRST);
    }
    expect(
      goBackDisabledReason(
        product((g) => {
          g.pendingRequest = {
            kind: "ROLLBACK",
            targetVersion: 2,
            changeId: null,
            requestedAt: local(21, 14, 50),
            requestedBy: "frank",
          };
        }),
      ),
    ).toBe("Making Version 2 live again…");
    expect(
      goBackDisabledReason(
        product((g) => {
          g.pendingRequest = {
            kind: "RESTART",
            targetVersion: null,
            changeId: null,
            requestedAt: local(21, 14, 50),
            requestedBy: "frank",
          };
        }),
      ),
    ).toBe("Wait until your last request is done.");
    expect(
      goBackDisabledReason(
        product((g) => {
          g.versions[4].status = "LAUNCHING";
        }),
      ),
    ).toBe("Wait until Version 5 is live.");
  });

  it("a refused Go back shows plainly until the live version moves on (X28)", () => {
    const draftOpen = product((g) => {
      g.lastRequestFailure = {
        kind: "ROLLBACK",
        reason: "your change isn't finished",
        at: local(21, 14, 40),
      };
    });
    expect(failedGoBack(draftOpen)).toBe(FINISH_YOUR_CHANGE_FIRST);
    // A new Go back on its way hides the older refusal.
    const retrying = product((g) => {
      g.lastRequestFailure = {
        kind: "ROLLBACK",
        reason: "your change isn't finished",
        at: local(21, 14, 40),
      };
      g.pendingRequest = {
        kind: "ROLLBACK",
        targetVersion: 2,
        changeId: null,
        requestedAt: local(21, 14, 50),
        requestedBy: "frank",
      };
    });
    expect(failedGoBack(retrying)).toBeNull();
    expect(
      requestFailureText({
        kind: "ROLLBACK",
        reason: "the old version didn't start",
        at: local(21, 14, 40),
      }),
    ).toBe("the old version didn't start");
    const old = product((g) => {
      g.lastRequestFailure = {
        kind: "ROLLBACK",
        reason: "your change isn't finished",
        at: local(21, 14, 0),
      };
    });
    expect(failedGoBack(old)).toBeNull();
    expect(failedGoBack(product())).toBeNull();
  });

  it("dates further back", () => {
    expect(whenText(local(18, 9, 0), NOW)).toBe("Oct 18");
    expect(whenText(new Date(2025, 11, 3).toISOString(), NOW)).toBe(
      "Dec 3, 2025",
    );
    expect(whenText(null, NOW)).toBe("Going live…");
  });
});
