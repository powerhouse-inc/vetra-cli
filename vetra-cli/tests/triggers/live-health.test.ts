import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  LAUNCH_REASONS,
  LAUNCH_TRIGGER,
  launch,
} from "../../src/launch/orchestrator.js";
import { dispatchProduct, productActions as a } from "../../src/product/product-doc.js";
import {
  HEALTH_FAILURES,
  healthPass,
  liveHealthTrigger,
  newHealthMemory,
  type CloudDeployment,
  type CloudStudioProduct,
  type HealthMemory,
} from "../../src/triggers/live-health.js";
import {
  AT,
  launchHarness,
  makeReady,
  readyChange,
  type LaunchHarness,
} from "../launch/orchestrator-helpers.js";

const BY = "did:pkh:eip155:1:0xowner";

/** A READY production deployment of the product, as `studioProduct` returns it. */
function cloudProduct(over: Partial<CloudDeployment> = {}): CloudStudioProduct {
  return {
    id: "app-1",
    latestDeployment: {
      id: "dep-2",
      status: "READY",
      kind: "PRODUCTION",
      trigger: "STUDIO_LAUNCH",
      versionNumber: 2,
      sha: "sha-2",
      gitRef: "refs/tags/v2",
      onBehalfOf: BY,
      packages: [{ name: "@vetra-apps/team-todo", version: "1.0.9" }],
      createdAt: "2026-10-21T09:02:00.000Z",
      updatedAt: "2026-10-21T09:05:00.000Z",
      ...over,
    },
  };
}

/** The cloud has nothing to say (no App yet, or none readable). */
const NO_CLOUD = { readProduct: async () => null };

/** Counts the SET_HEALTH operations the trigger actually writes. */
function countHealthWrites(h: LaunchHarness): () => number {
  const client = h.module.client as unknown as {
    execute: (...args: unknown[]) => Promise<unknown>;
  };
  const spy = jest.spyOn(client, "execute");
  return () =>
    spy.mock.calls
      .flatMap((call) => (call[2] as { type: string }[] | undefined) ?? [])
      .filter((action) => action.type === "SET_HEALTH").length;
}

/** Lets I/O settle, then checks the condition (no wall-clock waits). */
async function settle(check: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !check(); i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!check()) throw new Error("condition not met");
}

/** Version 1 is live (through the real orchestrator with the harness fakes). */
async function liveOnce(h: LaunchHarness): Promise<void> {
  await makeReady(h);
  await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
  expect((await h.state()).liveVersion).toBe(1);
}

/** Version 2 was started (the Studio stopped mid-launch), then recorded as failed. */
async function failedSecondLaunch(h: LaunchHarness): Promise<void> {
  await readyChange(h, "change-2");
  await dispatchProduct(h.ctx, [
    a.startLaunch({ number: 2, changeId: "change-2", at: AT }),
    a.failLaunch({ number: 2, reason: LAUNCH_REASONS.notAnswering, at: AT }),
  ]);
}

describe("live-health trigger", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("three failed checks mark the live app unhealthy, once", async () => {
    h = await launchHarness();
    await liveOnce(h);
    const errors: string[] = [];
    h.octx.log = { ...h.octx.log, error: (m: string) => errors.push(m) };

    const memory: HealthMemory = newHealthMemory();
    const writes = countHealthWrites(h);
    const failing = { ...NO_CLOUD, checkLive: async () => false };
    for (let i = 1; i < HEALTH_FAILURES; i++) {
      expect(await healthPass(h.octx, memory, failing)).toBeNull();
      expect((await h.state()).health).toBe("UNKNOWN");
    }

    expect(await healthPass(h.octx, memory, failing)).toBe("unhealthy");
    expect((await h.state()).health).toBe("UNHEALTHY");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("didn't answer 3 checks in a row");
    expect(writes()).toBe(1);

    // A fourth failed check writes the same state no second time.
    expect(await healthPass(h.octx, memory, failing)).toBeNull();
    expect(errors).toHaveLength(1);
    expect(writes()).toBe(1);
  });

  it("the next check that answers marks the live app healthy, once", async () => {
    h = await launchHarness();
    await liveOnce(h);
    const memory = newHealthMemory();
    const writes = countHealthWrites(h);
    const failing = { ...NO_CLOUD, checkLive: async () => false };
    for (let i = 0; i < HEALTH_FAILURES; i++) await healthPass(h.octx, memory, failing);
    expect((await h.state()).health).toBe("UNHEALTHY");

    const answering = { ...NO_CLOUD, checkLive: async () => true };
    expect(await healthPass(h.octx, memory, answering)).toBe("healthy");
    expect((await h.state()).health).toBe("HEALTHY");
    expect(writes()).toBe(2);
    // Nothing to write the second time.
    expect(await healthPass(h.octx, memory, answering)).toBeNull();
    expect(writes()).toBe(2);
  });

  it("cloud READY deployment reconciles a stale document", async () => {
    h = await launchHarness();
    await liveOnce(h);
    await failedSecondLaunch(h);

    const reads: string[] = [];
    const memory = newHealthMemory();
    await healthPass(h.octx, memory, {
      checkLive: async () => true,
      readProduct: async (_ctx, environmentId) => {
        reads.push(environmentId);
        return cloudProduct();
      },
    });

    expect(reads).toEqual(["studio-env-1"]);
    expect(memory.reconciled).toBe(true);
    const s = await h.state();
    expect(s.liveVersion).toBe(2);
    expect(s.liveDeploymentId).toBe("dep-2");
    expect(s.versions.map((v) => v.status)).toEqual(["PREVIOUS", "LIVE"]);
    const v2 = s.versions[1];
    expect(v2).toMatchObject({
      number: 2,
      gitTag: "v2",
      sha: "sha-2",
      deploymentId: "dep-2",
      title: "request for change-2",
      launchedBy: BY,
      trigger: "STUDIO_LAUNCH",
      launchedAt: "2026-10-21T09:05:00.000Z",
      changedFiles: [],
      failure: null,
    });
    expect(v2.packages).toEqual([{ name: "@vetra-apps/team-todo", version: "1.0.9" }]);
    expect(s.changes.find((c) => c.id === "change-2")?.status).toBe("LAUNCHED");

    // Once per process: the second pass does not read the cloud again.
    await healthPass(h.octx, memory, {
      checkLive: async () => true,
      readProduct: async () => {
        reads.push("again");
        return cloudProduct();
      },
    });
    expect(reads).toEqual(["studio-env-1"]);
  });

  it("a newer READY deployment of an earlier live version is set live again", async () => {
    h = await launchHarness();
    await liveOnce(h);
    await readyChange(h, "change-2");
    await launch(h.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });
    // The document was put back on Version 1 (a Go back the agent ran while
    // the cloud kept Version 2 READY): Version 2 is PREVIOUS, not re-launched.
    await dispatchProduct(h.ctx, [a.setLiveVersion({ number: 1, at: AT })]);
    expect((await h.state()).liveVersion).toBe(1);
    expect((await h.state()).versions[1].status).toBe("PREVIOUS");

    await healthPass(h.octx, newHealthMemory(), {
      checkLive: async () => true,
      readProduct: async () => cloudProduct(),
    });

    const s = await h.state();
    expect(s.liveVersion).toBe(2);
    expect(s.liveDeploymentId).toBe("dep-2");
    expect(s.versions.map((v) => v.status)).toEqual(["PREVIOUS", "LIVE"]);
  });

  it("reconcile is skipped while a Version is LAUNCHING, then retried", async () => {
    h = await launchHarness();
    await liveOnce(h);
    await readyChange(h, "change-2");
    await dispatchProduct(h.ctx, [a.startLaunch({ number: 2, changeId: "change-2", at: AT })]);

    let reads = 0;
    const deps = {
      checkLive: async () => true,
      readProduct: async () => {
        reads += 1;
        return cloudProduct();
      },
    };
    const memory = newHealthMemory();
    await healthPass(h.octx, memory, deps);

    expect(reads).toBe(0);
    expect(memory.reconciled).toBe(false);
    let s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.versions[1].status).toBe("LAUNCHING");

    // The launch is recorded as failed (the cloud lost it): the next pass
    // reconciles from what the cloud says is live.
    await dispatchProduct(h.ctx, [
      a.failLaunch({ number: 2, reason: LAUNCH_REASONS.notAnswering, at: AT }),
    ]);
    await healthPass(h.octx, memory, deps);
    expect(reads).toBe(1);
    s = await h.state();
    expect(s.liveVersion).toBe(2);
    expect(s.versions[1].status).toBe("LIVE");
  });

  it("does nothing before the product has gone live", async () => {
    h = await launchHarness();
    await makeReady(h);
    let reads = 0;
    let checks = 0;
    const memory = newHealthMemory();

    expect(
      await healthPass(h.octx, memory, {
        checkLive: async () => {
          checks += 1;
          return true;
        },
        readProduct: async () => {
          reads += 1;
          return cloudProduct();
        },
      }),
    ).toBeNull();

    expect(reads).toBe(0);
    expect(checks).toBe(0);
    expect(memory.reconciled).toBe(false);
    expect((await h.state()).health).toBe("UNKNOWN");
  });

  it("an unreadable cloud or check never throws out of the loop", async () => {
    h = await launchHarness();
    await liveOnce(h);
    const memory = newHealthMemory();

    expect(
      await healthPass(h.octx, memory, {
        checkLive: async () => {
          throw new Error("network down");
        },
        readProduct: async () => {
          throw new Error("Vetra didn't answer");
        },
      }),
    ).toBeNull();
    expect(memory.reconciled).toBe(false);
    expect((await h.state()).health).toBe("UNKNOWN");

    expect(
      await healthPass(h.octx, memory, {
        checkLive: async () => true,
        readProduct: async () => cloudProduct({ versionNumber: 1 }),
      }),
    ).toBe("healthy");
    expect(memory.reconciled).toBe(true);
    const s = await h.state();
    expect(s.health).toBe("HEALTHY");
    expect(s.liveVersion).toBe(1);
  });

  it("never overlaps a pass already under way", async () => {
    h = await launchHarness();
    await liveOnce(h);
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let checks = 0;
    const deps = {
      readProduct: NO_CLOUD.readProduct,
      checkLive: async () => {
        checks += 1;
        started.resolve();
        await gate.promise;
        return true;
      },
    };
    const memory = newHealthMemory();

    const first = healthPass(h.octx, memory, deps);
    await started.promise;
    expect(await healthPass(h.octx, memory, deps)).toBeNull();
    expect(checks).toBe(1);

    gate.resolve();
    await first;
    expect(memory.running).toBe(false);
    expect((await h.state()).health).toBe("HEALTHY");
  });

  it("the trigger starts one pass a minute and returns at once", async () => {
    h = await launchHarness();
    await makeReady(h); // no live version: the pass reads the document only
    const tstate = liveHealthTrigger.state!();
    const tctx = {
      state: tstate,
      commandContext: h.octx,
      context: { log: h.octx.log },
    } as unknown as Parameters<typeof liveHealthTrigger.poll>[0];

    // Returns at once; the pass itself runs detached.
    expect(await liveHealthTrigger.poll(tctx)).toBeNull();
    await settle(() => tstate.memory.running === false);
    const lastPassAt = tstate.lastPassAt;
    expect(lastPassAt).toBeGreaterThan(0);

    // Inside the minute: no second pass.
    await liveHealthTrigger.poll(tctx);
    expect(tstate.lastPassAt).toBe(lastPassAt);

    // Outside a Studio: nothing at all.
    const quiet = liveHealthTrigger.state!();
    await liveHealthTrigger.poll({
      ...tctx,
      state: quiet,
      commandContext: { ...h.octx, config: {} },
    } as unknown as Parameters<typeof liveHealthTrigger.poll>[0]);
    expect(quiet.lastPassAt).toBe(0);
  });
});
