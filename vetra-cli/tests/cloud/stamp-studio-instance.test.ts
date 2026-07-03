import {
  stampStudioInstance,
  type StudioInstanceStampable,
} from "../../src/cloud/stamp-studio-instance.js";

/** Fake controller that records setStudioInstance calls. */
function fakeController(
  studioInstanceId: string | null,
): StudioInstanceStampable & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    state: { global: { studioInstanceId } },
    setStudioInstance({ studioInstanceId }) {
      calls.push(studioInstanceId);
    },
  };
}

describe("stampStudioInstance", () => {
  it("stamps the studio env id onto an unlinked env", () => {
    const c = fakeController(null);
    stampStudioInstance(c, { environmentId: "studio-env-1" });
    expect(c.calls).toEqual(["studio-env-1"]);
  });

  it("no-ops when not running inside a studio (environmentId unset)", () => {
    const c = fakeController(null);
    stampStudioInstance(c, {});
    expect(c.calls).toEqual([]);
  });

  it("no-ops when environmentId is blank/whitespace", () => {
    const c = fakeController(null);
    stampStudioInstance(c, { environmentId: "   " });
    expect(c.calls).toEqual([]);
  });

  it("no-ops when the env is already linked to this studio", () => {
    const c = fakeController("studio-env-1");
    stampStudioInstance(c, { environmentId: "studio-env-1" });
    expect(c.calls).toEqual([]);
  });

  it("re-stamps when the env is linked to a different studio", () => {
    const c = fakeController("studio-env-old");
    stampStudioInstance(c, { environmentId: "studio-env-new" });
    expect(c.calls).toEqual(["studio-env-new"]);
  });
});
