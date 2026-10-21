import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs/promises";
import path from "node:path";
import { runProgress } from "../../src/commands/product/progress.js";
import { STUDIO_SECRET_ENV } from "../../src/launch/cloud-launch.js";
import { LaunchError } from "../../src/launch/errors.js";
import {
  AUTO_LAUNCHED_BY,
  DRAFT_OPEN_REASON,
  LAUNCH_TRIGGER,
  SECRET_PENDING_WAITS_MS,
  discardChange,
  launch,
  requestLiveTarget,
  restartLive,
  rollbackTo,
  syncAccess,
  versionTitle,
} from "../../src/launch/orchestrator.js";
import { DEPLOY_FAILED_REASON } from "../../src/launch/verify.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { AT, TARGET, a, launchHarness, makeReady, readyChange, type LaunchHarness } from "./orchestrator-helpers.js";

const BY = "did:pkh:eip155:1:0xowner";

describe("launch orchestrator", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("the first version goes live: lines in order, the product drive between deploy and verify", async () => {
    h = await launchHarness();
    await makeReady(h, "change-1", { title: "Team todo list" });

    const out = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });

    expect(out).toEqual({ status: "LIVE", number: 1 });
    expect(h.calls).toEqual([
      "ensureProduct Team Todo",
      'snapshot 1 "Team todo list" retag=false',
      "publish team-todo live=none",
      "launch 1 sha-1 v1",
      "wait dep-1",
      'drive app-1 https://team-todo-switchboard.vetra.io "Team Todo"',
      "setDrive app-1 drive-1",
      `check ${TARGET.liveUrl}`,
    ]);
    const s = await h.state();
    expect([s.appId, s.slug, s.liveUrl, s.productDriveId]).toEqual(["app-1", "team-todo", TARGET.liveUrl, "drive-1"]);
    expect(s.liveVersion).toBe(1);
    expect(s.liveSince).toBe(AT);
    expect(s.liveDeploymentId).toBe("dep-1");
    const v = s.versions[0];
    expect(v).toMatchObject({
      number: 1,
      status: "LIVE",
      title: "Team todo list",
      gitTag: "v1",
      sha: "sha-1",
      deploymentId: "dep-1",
      launchedBy: AUTO_LAUNCHED_BY,
      trigger: "STUDIO_LAUNCH",
      changedFiles: ["todo-app/document-models/todo/schema.graphql"],
    });
    expect(v.lines.map((l) => [l.kind, l.status])).toEqual([
      ["SNAPSHOT", "DONE"],
      ["PUBLISH", "DONE"],
      ["DEPLOY", "DONE"],
      ["VERIFY", "DONE"],
      ["MIRROR", "SKIPPED"],
    ]);
    const change = s.changes[0];
    expect(change.status).toBe("LAUNCHED");
    expect(change.steps.find((st) => st.kind === "LIVE")?.status).toBe("DONE");
  });

  it("a later launch keeps the package names of the live version and leaves the drive alone", async () => {
    h = await launchHarness();
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    h.calls.length = 0;
    await readyChange(h, "change-2");

    const out = await launch(h.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER, launchedBy: BY });

    expect(out).toEqual({ status: "LIVE", number: 2 });
    expect(h.calls).toEqual([
      'snapshot 2 "request for change-2" retag=false',
      "publish team-todo live=v1",
      "launch 2 sha-2 v2",
      "wait dep-2",
      `check ${TARGET.liveUrl}`,
    ]);
    const s = await h.state();
    expect(s.liveVersion).toBe(2);
    expect(s.versions.map((v) => [v.number, v.status])).toEqual([
      [1, "PREVIOUS"],
      [2, "LIVE"],
    ]);
    expect(s.versions[1].launchedBy).toBe(BY);
  });

  it("a failed deploy leaves liveVersion unchanged and records the reason", async () => {
    let fail = false;
    h = await launchHarness({
      waitForDeployment: async () => (fail ? { failed: DEPLOY_FAILED_REASON, detail: "ImagePullBackOff" } : "READY"),
    });
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    await readyChange(h, "change-2");
    fail = true;

    const out = await launch(h.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });

    expect(out).toEqual({ status: "FAILED", number: 2, reason: DEPLOY_FAILED_REASON });
    const s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.liveDeploymentId).toBe("dep-1");
    const v2 = s.versions[1];
    expect(v2.status).toBe("FAILED");
    expect(v2.failure).toBe("the new version didn't start");
    expect(v2.lines.find((l) => l.kind === "DEPLOY")).toEqual({ kind: "DEPLOY", status: "FAILED", detail: "dep-2" });
    expect(v2.lines.find((l) => l.kind === "VERIFY")?.status).toBe("WAITING");
    const change = s.changes[1];
    expect(change.status).toBe("READY");
    expect(change.steps.find((st) => st.kind === "LIVE")).toMatchObject({ status: "STOPPED", reason: DEPLOY_FAILED_REASON });
    expect(h.lines.some((l) => l.includes("Couldn't go live: the new version didn't start. Your live app is still on Version 1."))).toBe(true);
    expect(h.lines.some((l) => l.includes("ImagePullBackOff"))).toBe(true);
  });

  it("Try again reuses the version number and may move its tag (F23)", async () => {
    let fail = true;
    h = await launchHarness({ checkLive: async () => !fail });
    await makeReady(h);
    const first = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    expect(first).toEqual({ status: "FAILED", number: 1, reason: "your live app didn't answer" });
    expect((await h.state()).liveVersion).toBeNull();
    fail = false;
    h.calls.length = 0;

    const again = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER, launchedBy: BY });

    expect(again).toEqual({ status: "LIVE", number: 1 });
    expect(h.calls[0]).toBe('snapshot 1 "create a todo app" retag=true');
    // The drive was set at the first try; it is not created again.
    expect(h.calls.some((c) => c.startsWith("drive "))).toBe(false);
    const s = await h.state();
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0].status).toBe("LIVE");
  });

  it("budget exhausted during launch: version goes live, suggestions skipped", async () => {
    const afterLaunch = jest.fn(async () => {});
    h = await launchHarness({ afterLaunch, budgetUsedUp: async () => true });
    await makeReady(h);

    const out = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });

    expect(out).toEqual({ status: "LIVE", number: 1 });
    expect((await h.state()).liveVersion).toBe(1);
    expect(afterLaunch).not.toHaveBeenCalled();
    expect(h.lines.some((l) => l.includes("budget used up"))).toBe(true);
  });

  it("suggestions run after a launch while budget is left", async () => {
    const afterLaunch = jest.fn(async () => {});
    h = await launchHarness({ afterLaunch, budgetUsedUp: async () => false });
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    expect(afterLaunch).toHaveBeenCalledTimes(1);
  });

  it("waits out a launch secret that is still on its way, then goes on", async () => {
    let pending = 2;
    h = await launchHarness({
      cloudLaunch: async (_ctx, input) => {
        if (pending-- > 0) {
          throw new LaunchError("STUDIO_SECRET_PENDING", "your Studio is still getting ready to publish");
        }
        return { deploymentId: `dep-${input.versionNumber}`, status: "PENDING" };
      },
    });
    await makeReady(h);

    expect(await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER })).toEqual({ status: "LIVE", number: 1 });
    expect(h.sleeps).toEqual(SECRET_PENDING_WAITS_MS.slice(0, 2));
  });

  it("a launch secret that never arrives fails the launch with a plain reason", async () => {
    h = await launchHarness({
      cloudLaunch: async () => {
        throw new LaunchError("STUDIO_SECRET_PENDING", "your Studio is still getting ready to publish");
      },
    });
    await makeReady(h);
    const out = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    expect(out).toEqual({ status: "FAILED", number: 1, reason: "your Studio is still getting ready to publish" });
    expect(h.sleeps).toEqual(SECRET_PENDING_WAITS_MS);
  });

  it("a git failure records only its plain reason on the product, never git's output", async () => {
    h = await launchHarness({
      snapshot: async () => {
        throw new LaunchError(
          "GIT_FAILED",
          "the code couldn't be saved",
          "git rev-parse failed: fatal: detected dubious ownership in repository at '/home/clint/workspace'",
        );
      },
    });
    await makeReady(h);
    const out = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    expect(out).toEqual({ status: "FAILED", number: 1, reason: "the code couldn't be saved" });
    const doc = JSON.stringify(await h.state());
    expect(doc).toContain("the code couldn't be saved");
    expect(doc).not.toMatch(/dubious|fatal|\/home\/clint|rev-parse/);
  });

  it("examples the server refused are told in the story; the launch goes on", async () => {
    h = await launchHarness({
      ensureProductDrive: async () => ({
        driveId: "drive-1",
        accessApplied: false,
        access: null,
        failedExamples: ["Example — delete me: Groceries"],
      }),
    });
    await makeReady(h);
    expect((await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER })).status).toBe("LIVE");
    const milestones = (await h.state()).changes[0].milestones.map((m) => m.text);
    expect(milestones).toEqual(["One example couldn't be added to your product: Example — delete me: Groceries."]);
  });

  it("an unexpected error is recorded as a plain failure, never the raw message", async () => {
    h = await launchHarness({
      publishAll: async () => {
        throw new Error("ENOSPC: no space left on device");
      },
    });
    await makeReady(h);
    const out = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    expect(out).toEqual({ status: "FAILED", number: 1, reason: "something unexpected stopped it" });
    const v = (await h.state()).versions[0];
    expect(v.failure).toBe("something unexpected stopped it");
    expect(v.lines.find((l) => l.kind === "PUBLISH")?.status).toBe("FAILED");
  });

  it("does nothing for a change that isn't ready", async () => {
    h = await launchHarness();
    const out = await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    expect(out.status).toBe("SKIPPED");
    expect(h.calls).toEqual([]);
    expect((await h.state()).versions).toEqual([]);
  });

  it("the version title is the change title, else the request cut to 60 characters (F13)", () => {
    expect(versionTitle({ title: " Kitchen notes ", request: "x" })).toBe("Kitchen notes");
    const long = "add a field for notes to the kitchen on every order so the cooks can see allergies";
    expect(versionTitle({ title: null, request: long })).toBe(long.slice(0, 60).trimEnd());
    expect(versionTitle({ title: null, request: long }).length).toBeLessThanOrEqual(60);
  });
});

describe("requests", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  async function twoVersions(harness: LaunchHarness): Promise<void> {
    await makeReady(harness);
    await launch(harness.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    await readyChange(harness, "change-2");
    await launch(harness.octx, { changeId: "change-2", trigger: LAUNCH_TRIGGER });
    harness.calls.length = 0;
  }

  it("Go back makes the earlier version live again and moves the code to it", async () => {
    h = await launchHarness();
    await twoVersions(h);
    await dispatchProduct(h.ctx, [a.requestRollback({ versionNumber: 1, requestedAt: AT, requestedBy: BY })]);

    expect(await rollbackTo(h.octx, 1)).toEqual({ status: "DONE" });

    expect(h.calls).toEqual(["restore 1", "rollback dep-1", "wait dep-1-again"]);
    const s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.liveDeploymentId).toBe("dep-1-again");
    expect(s.pendingRequest).toBeNull();
    expect(s.versions.map((v) => [v.number, v.status])).toEqual([
      [1, "LIVE"],
      [2, "PREVIOUS"],
    ]);
  });

  it("Go back with unsaved changes is refused with a plain reason the page can show", async () => {
    h = await launchHarness({
      restoreVersion: async () => {
        throw new LaunchError("DRAFT_OPEN", "there are unsaved changes in your Studio");
      },
    });
    await twoVersions(h);
    await dispatchProduct(h.ctx, [a.requestRollback({ versionNumber: 1, requestedAt: AT, requestedBy: BY })]);

    expect(await rollbackTo(h.octx, 1)).toEqual({ status: "REFUSED", reason: DRAFT_OPEN_REASON });

    expect(h.calls).toEqual([]);
    const s = await h.state();
    expect(s.liveVersion).toBe(2);
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toEqual({ kind: "ROLLBACK", reason: DRAFT_OPEN_REASON, at: AT });
    expect(h.lines.some((l) => l.includes(DRAFT_OPEN_REASON))).toBe(true);
  });

  it("a failed Go back puts the code back on the version that is still live", async () => {
    const restored: number[] = [];
    h = await launchHarness({
      waitForDeployment: async (_ctx, id) => (id.endsWith("-again") ? { failed: "x", detail: "CrashLoop" } : "READY"),
      restoreVersion: async (_wd, m) => {
        restored.push(m);
        return { sha: "s" };
      },
    });
    await twoVersions(h);
    await dispatchProduct(h.ctx, [a.requestRollback({ versionNumber: 1, requestedAt: AT, requestedBy: BY })]);

    expect((await rollbackTo(h.octx, 1)).status).toBe("FAILED");
    expect(restored).toEqual([1, 2]);
    const s = await h.state();
    expect(s.liveVersion).toBe(2);
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toMatchObject({ kind: "ROLLBACK", at: AT });
  });

  it("Restart re-deploys the live deployment without touching the code (F15)", async () => {
    h = await launchHarness();
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    h.calls.length = 0;
    await dispatchProduct(h.ctx, [a.requestRestart({ requestedAt: AT, requestedBy: BY })]);

    expect(await restartLive(h.octx)).toEqual({ status: "DONE" });

    expect(h.calls).toEqual(["rollback dep-1", "wait dep-1-again"]);
    const s = await h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.liveDeploymentId).toBe("dep-1-again");
    expect(s.pendingRequest).toBeNull();
  });

  it("a failed Restart is visible instead of only logged", async () => {
    h = await launchHarness({
      cloudRollback: async () => {
        throw new LaunchError("CLOUD_UNAVAILABLE", "your live app couldn't be restarted", "503");
      },
    });
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    await dispatchProduct(h.ctx, [a.requestRestart({ requestedAt: AT, requestedBy: BY })]);

    expect((await restartLive(h.octx)).status).toBe("FAILED");

    const s = await h.state();
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toEqual({
      kind: "RESTART",
      reason: "your live app couldn't be restarted",
      at: AT,
    });
  });

  it("Discard marks the change DISCARDED so it can never launch itself", async () => {
    h = await launchHarness();
    await makeReady(h);
    await dispatchProduct(h.ctx, [a.requestDiscard({ changeId: "change-1", requestedAt: AT, requestedBy: BY })]);

    expect(await discardChange(h.octx, "change-1")).toEqual({ status: "DONE" });

    const s = await h.state();
    expect(s.changes[0].status).toBe("DISCARDED");
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toBeNull();
  });

  it("the access switch is applied to the product drive and then left alone (F35)", async () => {
    h = await launchHarness();
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    h.calls.length = 0;
    const applied = new Map<string, "OWNER_ONLY" | "SIGNED_IN">();

    // No local record of the drive: the setting is applied once.
    expect(await syncAccess(h.octx, applied)).toBe("applied");
    expect(await syncAccess(h.octx, applied)).toBe("in-sync");
    await dispatchProduct(h.ctx, [a.setAccess({ access: "OWNER_ONLY" })]);
    expect(await syncAccess(h.octx, applied)).toBe("applied");
    expect(h.calls).toEqual(["access SIGNED_IN drive-1", "access OWNER_ONLY drive-1"]);
  });

  it("an adopted drive keeps its protection: the product follows it first", async () => {
    h = await launchHarness();
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    h.calls.length = 0;
    const markerPath = path.join(h.workdir, ".ph", "product-drive.json");
    await fs.writeFile(
      markerPath,
      JSON.stringify({
        switchboardUrl: "https://team-todo-switchboard.vetra.io/graphql",
        driveId: "drive-1",
        adopted: true,
        seed: false,
        accessApplied: true,
        accessSet: false,
        access: "OWNER_ONLY",
        examples: [],
        done: true,
      }),
    );
    const applied = new Map<string, "OWNER_ONLY" | "SIGNED_IN">();

    expect(await syncAccess(h.octx, applied)).toBe("applied");

    // The product document takes the drive's protection; the drive is untouched.
    expect(h.calls).toEqual([]);
    expect((await h.state()).access).toBe("OWNER_ONLY");
    const marker = JSON.parse(await fs.readFile(markerPath, "utf-8")) as { accessSet: boolean };
    expect(marker.accessSet).toBe(true);
    expect(await syncAccess(h.octx, applied)).toBe("in-sync");

    // Only a later customer change is pushed to the drive.
    await dispatchProduct(h.ctx, [a.setAccess({ access: "SIGNED_IN" })]);
    expect(await syncAccess(h.octx, applied)).toBe("applied");
    expect(h.calls).toEqual(["access SIGNED_IN drive-1"]);
  });

  it("an adopted drive whose protection couldn't be read is left alone", async () => {
    h = await launchHarness();
    await makeReady(h);
    await launch(h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });
    h.calls.length = 0;
    await fs.writeFile(
      path.join(h.workdir, ".ph", "product-drive.json"),
      JSON.stringify({
        switchboardUrl: "https://team-todo-switchboard.vetra.io/graphql",
        driveId: "drive-1",
        adopted: true,
        seed: false,
        accessApplied: false,
        accessSet: false,
        access: null,
        examples: [],
        done: true,
      }),
    );

    expect(await syncAccess(h.octx, new Map())).toBe("skipped");
    expect(h.calls).toEqual([]);
    expect((await h.state()).access).toBe("SIGNED_IN");
  });
});

describe("live address when the plan is done (D8)", () => {
  let h: LaunchHarness | undefined;
  afterEach(async () => {
    await h?.cleanup();
    h = undefined;
  });

  it("App and environment are requested when the plan is done", async () => {
    h = await launchHarness();
    const bodies: string[] = [];
    const headers: Record<string, string>[] = [];
    const ctx = {
      ...h.octx,
      deps: { ...h.deps, ensureProduct: (await import("../../src/launch/cloud-launch.js")).ensureProduct },
      env: { [STUDIO_SECRET_ENV]: "" },
      bearerToken: async () => "bearer-1",
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body));
        headers.push(init?.headers as Record<string, string>);
        return new Response(
          JSON.stringify({
            data: {
              ensureStudioProduct: {
                id: "app-9",
                slug: "team-todo",
                productionEnvironmentId: "env-9",
                productionUrls: { connect: "https://team-todo.vetra.io" },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    };
    await runProgress(ctx, { action: "name", text: "Team Todo" });
    await runProgress(ctx, { action: "title", text: "Team todo list" });
    await runProgress(ctx, { action: "plan", steps: [{ kind: "PLAN" }, { kind: "DATA" }] });
    expect(await runProgress(ctx, { action: "start", step: "PLAN" })).toContain("Plan started.");
    expect(bodies).toEqual([]);

    expect(await runProgress(ctx, { action: "done", step: "PLAN" })).toContain("Plan done.");
    await requestLiveTarget(ctx); // joins the request already under way

    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]).variables).toEqual({ input: { studioEnvironmentId: "studio-env-1", name: "Team Todo" } });
    expect(headers[0]["x-vetra-studio-secret"]).toBe("");
    const s = await h.state();
    expect([s.appId, s.productionEnvironmentId, s.slug, s.liveUrl]).toEqual([
      "app-9",
      "env-9",
      "team-todo",
      "https://team-todo.vetra.io",
    ]);
  });

  it("a refused request is logged at error and tried again at the next step change", async () => {
    let refuse = true;
    const ensure = jest.fn(async () => {
      if (refuse) throw new LaunchError("STUDIO_SECRET_PENDING", "your Studio is still getting ready to publish");
      return TARGET;
    });
    h = await launchHarness({ ensureProduct: ensure, sleep: async () => {} });
    const errors: string[] = [];
    const ctx = { ...h.octx, log: { ...h.octx.log, error: (m: string) => errors.push(m) } };
    await runProgress(ctx, { action: "name", text: "Team Todo" });
    await runProgress(ctx, { action: "title", text: "Team todo list" });
    await runProgress(ctx, { action: "plan", steps: [{ kind: "PLAN" }, { kind: "DATA" }] });
    await runProgress(ctx, { action: "done", step: "PLAN" });
    expect(await requestLiveTarget(ctx)).toBe(false);
    expect(errors.some((e) => e.includes("live address not set up yet"))).toBe(true);
    expect((await h.state()).appId).toBeNull();

    refuse = false;
    await runProgress(ctx, { action: "start", step: "DATA" });
    expect(await requestLiveTarget(ctx)).toBe(true);
    expect((await h.state()).appId).toBe("app-1");
  });
});
