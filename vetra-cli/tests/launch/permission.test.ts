import { afterEach, describe, expect, it } from "@jest/globals";
import { LaunchError } from "../../src/launch/errors.js";
import {
  LAUNCH_TRIGGER,
  launch,
  resumeLaunch,
} from "../../src/launch/orchestrator.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import {
  a,
  launchHarness,
  makeReady,
  type LaunchHarness,
} from "./orchestrator-helpers.js";

const NEEDS_OK = "your Studio needs your OK to publish";

/** publishAll that refuses until the test lets it through. */
function publishRefusal(error: LaunchError) {
  return async () => {
    throw error;
  };
}

describe("launch permission (F7)", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("launch waits for permission and resumes when granted", async () => {
    h = await launchHarness({
      publishAll: publishRefusal(new LaunchError("DELEGATION_MISSING", NEEDS_OK, NEEDS_OK)),
    });
    await makeReady(h);

    expect(
      await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER }),
    ).toEqual({ status: "NEEDS_PERMISSION", number: 1 });

    let s = await h.state();
    expect(s.launchPermission).toBe("MISSING");
    expect(s.liveVersion).toBeNull();
    expect(s.changes[0].status).toBe("LAUNCHING");
    const v = s.versions[0];
    expect(v.status).toBe("LAUNCHING");
    expect(v.failure).toBeNull();
    expect(v.lines.find((l) => l.kind === "SNAPSHOT")).toMatchObject({
      status: "DONE",
      detail: "sha-1",
    });
    // The running line is back to WAITING, so the resume re-runs it.
    expect(v.lines.find((l) => l.kind === "PUBLISH")).toEqual({
      kind: "PUBLISH",
      status: "WAITING",
      detail: null,
    });

    // Still refused: the Version keeps waiting, it does not fail.
    expect(await resumeLaunch(h.octx, 1)).toEqual({
      status: "NEEDS_PERMISSION",
      number: 1,
    });
    expect((await h.state()).versions[0].status).toBe("LAUNCHING");

    // The page records the owner's OK: the same Version resumes and goes live.
    h.deps.publishAll = async () => [
      { name: "@vetra-apps/team-todo", version: "1.0.1" },
    ];
    await dispatchProduct(h.ctx, [
      a.setLaunchPermission({ state: "GRANTED" }),
    ]);
    expect(await resumeLaunch(h.octx, 1)).toEqual({ status: "LIVE", number: 1 });

    s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.versions[0].status).toBe("LIVE");
    expect(s.launchPermission).toBe("GRANTED");
  });

  it("maps the cloud codes: a missing delegation is MISSING, a spent one EXPIRED", async () => {
    const cases = [
      ["DELEGATION_MISSING", "MISSING"],
      ["DELEGATION_EXPIRED", "EXPIRED"],
      ["PERMISSION", "EXPIRED"],
    ] as const;
    for (const [code, expected] of cases) {
      h = await launchHarness({
        publishAll: publishRefusal(new LaunchError(code, NEEDS_OK, code)),
      });
      await makeReady(h);

      expect(
        await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER }),
      ).toEqual({ status: "NEEDS_PERMISSION", number: 1 });
      expect((await h.state()).launchPermission).toBe(expected);

      await h.cleanup();
      h = undefined;
    }
  });

  it("STUDIO_BINDING stays a normal launch failure", async () => {
    const reason = "your Studio isn't connected to its live app yet";
    h = await launchHarness({
      ensureProduct: async () => {
        throw new LaunchError("STUDIO_BINDING", reason, reason);
      },
    });
    await makeReady(h);

    expect(
      await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER }),
    ).toEqual({ status: "FAILED", number: 1, reason });

    const s = await h.state();
    expect(s.launchPermission).toBe("UNKNOWN");
    expect(s.liveVersion).toBeNull();
    expect(s.versions[0]).toMatchObject({ status: "FAILED", failure: reason });
  });
});
