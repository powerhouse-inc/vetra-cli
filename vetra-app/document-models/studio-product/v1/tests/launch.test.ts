import type {
  StudioProductAction,
  StudioProductDocument,
  StudioProductState,
  Version,
} from "document-models/studio-product/v1";
import {
  clearRequest,
  completeLaunch,
  completeStep,
  failLaunch,
  planSteps,
  requestDiscard,
  requestLaunch,
  requestMirror,
  requestRestart,
  requestRollback,
  setChangeTitle,
  setHealth,
  setLaunchLine,
  setLaunchPermission,
  setLiveTarget,
  setLiveVersion,
  setProductDrive,
  startChange,
  startLaunch,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import {
  allPassing,
  apply,
  at,
  building,
  change,
  craftedChange,
  errorAt,
  lastError,
  run,
  step,
  withState,
} from "./helpers.js";

const by = "did:key:owner";

/** The first build `c1`, READY (every gate met, LIVE still to go). */
function ready(): StudioProductDocument {
  return apply(
    building(),
    completeStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
    run("r-gen", 3, { GENERATE: true }),
    completeStep({ changeId: "c1", kind: "DATA", at: at(4) }),
    run("r-smoke", 5, { SMOKE: true }),
    completeStep({ changeId: "c1", kind: "EDITORS", at: at(6) }),
    allPassing("r-all", 7),
    completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
  );
}

function complete(
  number: number,
  minute: number,
  extra: Partial<Parameters<typeof completeLaunch>[0]> = {},
): StudioProductAction {
  return completeLaunch({
    number,
    gitTag: `v${number}`,
    sha: `sha-${number}`,
    packages: [{ name: "@vetra-apps/dog-walks", version: `0.${number}.0` }],
    deploymentId: `dep-${number}`,
    title: `Version title ${number}`,
    summary: `summary ${number}`,
    changedFiles: [`file-${number}.ts`],
    launchedBy: by,
    trigger: "STUDIO_LAUNCH",
    at: at(minute),
    ...extra,
  });
}

/** Version 1 live from change c1. */
function live(): StudioProductDocument {
  return apply(
    ready(),
    startLaunch({ number: 1, changeId: "c1", at: at(9) }),
    complete(1, 10),
  );
}

/** A READY CHANGE `id` on top of `doc` (only TESTS and LIVE planned). */
function readyChange(
  doc: StudioProductDocument,
  id: string,
  minute: number,
): StudioProductDocument {
  return apply(
    doc,
    startChange({
      id,
      kind: "CHANGE",
      request: `request ${id}`,
      startedAt: at(minute),
    }),
    planSteps({ changeId: id, steps: [{ kind: "TESTS" }, { kind: "LIVE" }] }),
    allPassing(`r-${id}`, minute + 1, id),
    completeStep({ changeId: id, kind: "TESTS", at: at(minute + 2) }),
  );
}

/** v1 PREVIOUS, v2 LIVE (from c2), nothing open. */
function twoVersions(): StudioProductDocument {
  return apply(
    readyChange(live(), "c2", 20),
    startLaunch({ number: 2, changeId: "c2", at: at(30) }),
    complete(2, 31),
  );
}

function version(doc: StudioProductDocument, number: number): Version {
  const found = doc.state.global.versions.find((v) => v.number === number);
  if (!found) throw new Error(`version ${number} missing in test`);
  return found;
}

function craftedVersion(number: number, extra: Partial<Version>): Version {
  return {
    number,
    title: `v${number}`,
    summary: null,
    changeId: null,
    gitTag: `v${number}`,
    sha: "",
    packages: [],
    deploymentId: null,
    launchedAt: null,
    launchedBy: "",
    trigger: "",
    status: "LAUNCHING",
    lines: [],
    changedFiles: [],
    failure: null,
    rollbackBlockedReason: null,
    ...extra,
  };
}

describe("LaunchOperations", () => {
  describe("SET_LIVE_TARGET", () => {
    const target = (slug: string, appId = "app-1") =>
      setLiveTarget({
        appId,
        productionEnvironmentId: `env-${appId}`,
        slug,
        liveUrl: `https://${slug}.vetra.io`,
      });

    it("records the target and may be overwritten before the first launch", () => {
      const doc = apply(
        utils.createDocument(),
        target("dog-walks"),
        target("dog-walkers", "app-2"),
      );
      expect(lastError(doc)).toBeNull();
      expect(doc.state.global).toMatchObject({
        appId: "app-2",
        productionEnvironmentId: "env-app-2",
        slug: "dog-walkers",
        liveUrl: "https://dog-walkers.vetra.io",
      });
    });

    it("slug cannot change after first launch", () => {
      // A product that went live before its slug was recorded may still set it.
      const base = apply(live(), target("dog-walks"));
      expect(lastError(base)).toBeNull();
      const doc = apply(
        base,
        target("cat-walks"),
        target("dog-walks", "app-9"),
      );
      const i = base.operations.global.length;
      expect(errorAt(doc, i)).toBe(
        'The live address is fixed at "dog-walks" since the first launch.',
      );
      // The same slug still updates the App and its environment.
      expect(errorAt(doc, i + 1)).toBeNull();
      expect(doc.state.global.slug).toBe("dog-walks");
      expect(doc.state.global.appId).toBe("app-9");
    });
  });

  describe("SET_PRODUCT_DRIVE", () => {
    it("stores the drive once and updates the live address when given", () => {
      const doc = apply(
        withState({ liveUrl: "https://dog-walks.vetra.io" }),
        setProductDrive({ driveId: "phd:drive-1" }),
      );
      expect(doc.state.global.productDriveId).toBe("phd:drive-1");
      expect(doc.state.global.liveUrl).toBe("https://dog-walks.vetra.io");

      const again = apply(
        doc,
        setProductDrive({
          driveId: "phd:drive-1",
          liveUrl: "https://dog-walks.vetra.io/d/drive-1",
        }),
        setProductDrive({ driveId: "phd:drive-2" }),
      );
      expect(errorAt(again, 1)).toBeNull();
      expect(errorAt(again, 2)).toBe(
        'The product drive is already "phd:drive-1".',
      );
      expect(again.state.global.productDriveId).toBe("phd:drive-1");
      expect(again.state.global.liveUrl).toBe(
        "https://dog-walks.vetra.io/d/drive-1",
      );
    });
  });

  describe("requests", () => {
    it("REQUEST_LAUNCH needs a READY change and records the request", () => {
      const doc = apply(
        building(),
        requestLaunch({ changeId: "c1", requestedAt: at(2), requestedBy: by }),
        requestLaunch({
          changeId: "nope",
          requestedAt: at(2),
          requestedBy: by,
        }),
      );
      expect(errorAt(doc, 3)).toBe(
        'Change "c1" is BUILDING; only a READY change can go live.',
      );
      expect(errorAt(doc, 4)).toBe('No change "nope" exists.');
      expect(doc.state.global.pendingRequest).toBeNull();

      const ok = apply(
        ready(),
        requestLaunch({ changeId: "c1", requestedAt: at(9), requestedBy: by }),
      );
      expect(lastError(ok)).toBeNull();
      expect(ok.state.global.pendingRequest).toEqual({
        kind: "LAUNCH",
        changeId: "c1",
        targetVersion: null,
        requestedAt: at(9),
        requestedBy: by,
      });
    });

    it("every REQUEST_* is refused while a request is pending", () => {
      const base = apply(
        live(),
        requestRestart({ requestedAt: at(11), requestedBy: by }),
      );
      const withChange = readyChange(base, "c2", 12);
      const doc = apply(
        withChange,
        requestLaunch({ changeId: "c2", requestedAt: at(20), requestedBy: by }),
        requestDiscard({
          changeId: "c2",
          requestedAt: at(20),
          requestedBy: by,
        }),
        requestRestart({ requestedAt: at(20), requestedBy: by }),
        requestMirror({ requestedAt: at(20), requestedBy: by }),
      );
      const i = withChange.operations.global.length;
      for (let k = 0; k < 4; k++) {
        expect(errorAt(doc, i + k)).toBe(
          "A RESTART request is still waiting for the agent.",
        );
      }
      expect(doc.state.global.pendingRequest?.kind).toBe("RESTART");

      // The rollback check runs on a product with nothing open.
      const rollback = apply(
        twoVersions(),
        requestMirror({ requestedAt: at(40), requestedBy: by }),
        requestRollback({
          versionNumber: 1,
          requestedAt: at(41),
          requestedBy: by,
        }),
      );
      expect(lastError(rollback)).toBe(
        "A MIRROR request is still waiting for the agent.",
      );
    });

    it("CLEAR_REQUEST removes the pending request", () => {
      const doc = apply(
        live(),
        requestMirror({ requestedAt: at(11), requestedBy: by }),
        clearRequest({}),
        requestRestart({ requestedAt: at(12), requestedBy: by }),
      );
      expect(lastError(doc)).toBeNull();
      expect(doc.state.global.pendingRequest).toEqual({
        kind: "RESTART",
        changeId: null,
        targetVersion: null,
        requestedAt: at(12),
        requestedBy: by,
      });
    });

    it("REQUEST_RESTART is refused while a version is being launched", () => {
      const doc = apply(
        readyChange(live(), "c2", 20),
        startLaunch({ number: 2, changeId: "c2", at: at(25) }),
        requestRestart({ requestedAt: at(26), requestedBy: by }),
      );
      expect(lastError(doc)).toBe(
        "Version 2 is being launched; restart once it is done.",
      );
      expect(doc.state.global.pendingRequest).toBeNull();
    });

    it("REQUEST_RESTART and REQUEST_MIRROR need a live version", () => {
      const doc = apply(
        ready(),
        requestRestart({ requestedAt: at(9), requestedBy: by }),
        requestMirror({ requestedAt: at(9), requestedBy: by }),
      );
      expect(errorAt(doc, 10)).toBe("The product has no live version yet.");
      expect(errorAt(doc, 11)).toBe("The product has no live version yet.");
      const ok = apply(
        live(),
        requestMirror({ requestedAt: at(11), requestedBy: by }),
      );
      expect(ok.state.global.pendingRequest).toMatchObject({
        kind: "MIRROR",
        requestedAt: at(11),
        requestedBy: by,
      });
    });

    it("REQUEST_DISCARD records an open change and refuses one in flight or closed", () => {
      const doc = apply(
        building(),
        requestDiscard({ changeId: "c1", requestedAt: at(2), requestedBy: by }),
      );
      expect(doc.state.global.pendingRequest).toEqual({
        kind: "DISCARD",
        changeId: "c1",
        targetVersion: null,
        requestedAt: at(2),
        requestedBy: by,
      });
      const launching = apply(
        ready(),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
        requestDiscard({ changeId: "c1", requestedAt: at(9), requestedBy: by }),
        requestDiscard({ changeId: "x", requestedAt: at(9), requestedBy: by }),
      );
      expect(errorAt(launching, 11)).toBe(
        'Change "c1" is LAUNCHING and can\'t be discarded.',
      );
      expect(errorAt(launching, 12)).toBe('No change "x" exists.');
      expect(launching.state.global.pendingRequest).toBeNull();
    });

    it("REQUEST_ROLLBACK targets a previous version while no change is open", () => {
      const blocked = apply(
        readyChange(live(), "c2", 20),
        requestRollback({
          versionNumber: 1,
          requestedAt: at(25),
          requestedBy: by,
        }),
      );
      expect(lastError(blocked)).toBe(
        'Change "c2" is READY; finish or discard it first.',
      );

      const base = twoVersions();
      const doc = apply(
        base,
        requestRollback({
          versionNumber: 7,
          requestedAt: at(40),
          requestedBy: by,
        }),
        requestRollback({
          versionNumber: 2,
          requestedAt: at(40),
          requestedBy: by,
        }),
        requestRollback({
          versionNumber: 1,
          requestedAt: at(41),
          requestedBy: by,
        }),
      );
      const i = base.operations.global.length;
      expect(errorAt(doc, i)).toBe("No version 7 exists.");
      expect(errorAt(doc, i + 1)).toBe(
        "Version 2 is LIVE; only a previous live version can be made live again.",
      );
      expect(errorAt(doc, i + 2)).toBeNull();
      expect(doc.state.global.pendingRequest).toEqual({
        kind: "ROLLBACK",
        changeId: null,
        targetVersion: 1,
        requestedAt: at(41),
        requestedBy: by,
      });
    });
  });

  describe("START_LAUNCH", () => {
    it("opens the next version with every line waiting", () => {
      const doc = apply(
        ready(),
        setChangeTitle({ changeId: "c1", title: "Dog walk planner" }),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
      );
      expect(lastError(doc)).toBeNull();
      expect(change(doc).status).toBe("LAUNCHING");
      expect(step(doc, "LIVE")).toMatchObject({
        status: "WORKING",
        updatedAt: at(9),
      });
      expect(version(doc, 1)).toEqual({
        number: 1,
        title: "Dog walk planner",
        summary: null,
        changeId: "c1",
        gitTag: "v1",
        sha: "",
        packages: [],
        deploymentId: null,
        launchedAt: null,
        launchedBy: "",
        trigger: "",
        status: "LAUNCHING",
        lines: ["SNAPSHOT", "PUBLISH", "DEPLOY", "VERIFY", "MIRROR"].map(
          (kind) => ({ kind, status: "WAITING", detail: null }),
        ),
        changedFiles: [],
        failure: null,
        rollbackBlockedReason: null,
      });
      expect(doc.state.global.liveVersion).toBeNull();
    });

    it("refuses a change that isn't READY, an unknown change and a wrong number", () => {
      const doc = apply(
        building(),
        startLaunch({ number: 1, changeId: "c1", at: at(2) }),
        startLaunch({ number: 1, changeId: "zz", at: at(2) }),
      );
      expect(errorAt(doc, 3)).toBe(
        'Change "c1" is BUILDING; only a READY change can be launched.',
      );
      expect(errorAt(doc, 4)).toBe('No change "zz" exists.');

      const wrong = apply(
        ready(),
        startLaunch({ number: 2, changeId: "c1", at: at(9) }),
        startLaunch({ number: 0, changeId: "c1", at: at(9) }),
      );
      expect(errorAt(wrong, 10)).toBe(
        "Version 2 can't be launched; the next version is 1.",
      );
      expect(errorAt(wrong, 11)).toBe(
        "Version 0 can't be launched; the next version is 1.",
      );
      expect(wrong.state.global.versions).toEqual([]);

      // A version that went live can't be launched again under its number.
      const relaunch = apply(
        readyChange(live(), "c2", 20),
        startLaunch({ number: 1, changeId: "c2", at: at(25) }),
      );
      expect(lastError(relaunch)).toBe(
        "Version 1 can't be launched; the next version is 2.",
      );
    });
  });

  describe("SET_LAUNCH_LINE", () => {
    it("updates a line, keeps the detail when omitted and adds a missing line in order", () => {
      const doc = apply(
        ready(),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
        setLaunchLine({
          number: 1,
          kind: "DEPLOY",
          status: "RUNNING",
          detail: "dep-1",
        }),
        setLaunchLine({ number: 1, kind: "DEPLOY", status: "DONE" }),
        setLaunchLine({ number: 3, kind: "DEPLOY", status: "DONE" }),
      );
      expect(version(doc, 1).lines[2]).toEqual({
        kind: "DEPLOY",
        status: "DONE",
        detail: "dep-1",
      });
      expect(lastError(doc)).toBe("No version 3 exists.");

      const crafted = apply(
        withState({
          versions: [
            craftedVersion(1, {
              lines: [{ kind: "MIRROR", status: "WAITING", detail: null }],
            }),
          ],
        }),
        setLaunchLine({ number: 1, kind: "PUBLISH", status: "RUNNING" }),
        setLaunchLine({
          number: 1,
          kind: "SNAPSHOT",
          status: "DONE",
          detail: "abc",
        }),
      );
      expect(version(crafted, 1).lines).toEqual([
        { kind: "SNAPSHOT", status: "DONE", detail: "abc" },
        { kind: "PUBLISH", status: "RUNNING", detail: null },
        { kind: "MIRROR", status: "WAITING", detail: null },
      ]);
    });
  });

  describe("COMPLETE_LAUNCH", () => {
    it("makes the version LIVE and the change LAUNCHED with its live time", () => {
      const doc = live();
      expect(lastError(doc)).toBeNull();
      const s = doc.state.global;
      expect(s.liveVersion).toBe(1);
      expect(s.liveSince).toBe(at(10));
      expect(s.liveDeploymentId).toBe("dep-1");
      expect(version(doc, 1)).toMatchObject({
        status: "LIVE",
        gitTag: "v1",
        sha: "sha-1",
        packages: [{ name: "@vetra-apps/dog-walks", version: "0.1.0" }],
        deploymentId: "dep-1",
        title: "Version title 1",
        summary: "summary 1",
        changedFiles: ["file-1.ts"],
        launchedBy: by,
        trigger: "STUDIO_LAUNCH",
        launchedAt: at(10),
        failure: null,
      });
      expect(change(doc).status).toBe("LAUNCHED");
      expect(change(doc).metrics.liveAt).toBe(at(10));
      expect(step(doc, "LIVE")).toMatchObject({
        status: "DONE",
        reason: null,
        updatedAt: at(10),
      });
    });

    it("moves the previous LIVE version to PREVIOUS", () => {
      const doc = twoVersions();
      expect(doc.state.global.liveVersion).toBe(2);
      expect(version(doc, 1).status).toBe("PREVIOUS");
      expect(version(doc, 2).status).toBe("LIVE");
      expect(change(doc, "c2").status).toBe("LAUNCHED");
    });

    it("is refused for a version that isn't launching, an unknown version and repeated packages", () => {
      const base = live();
      const doc = apply(
        base,
        complete(1, 11),
        complete(4, 11),
        complete(1, 11, {
          packages: [
            { name: "a", version: "1" },
            { name: "a", version: "2" },
          ],
        }),
      );
      const i = base.operations.global.length;
      expect(errorAt(doc, i)).toBe(
        "Version 1 is LIVE; only a launching version can complete.",
      );
      expect(errorAt(doc, i + 1)).toBe("No version 4 exists.");

      const dup = apply(
        ready(),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
        complete(1, 10, {
          packages: [
            { name: "a", version: "1" },
            { name: "a", version: "2" },
          ],
        }),
      );
      expect(lastError(dup)).toBe('Package "a" is listed more than once.');
      expect(dup.state.global.liveVersion).toBeNull();
    });

    it("reconciles a FAILED version; a change that moved on is left alone", () => {
      // Recorded as failed, but the cloud finished it: the change is READY again.
      const doc = apply(
        ready(),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
        failLaunch({ number: 1, reason: "the check timed out", at: at(10) }),
        complete(1, 12, { summary: null }),
      );
      expect(lastError(doc)).toBeNull();
      expect(version(doc, 1)).toMatchObject({
        status: "LIVE",
        failure: null,
        summary: null,
      });
      expect(change(doc).status).toBe("LAUNCHED");

      // A version without a change, and one whose change is no longer
      // launching or ready, only update the versions.
      const crafted = apply(
        withState({
          changes: [craftedChange("c9", "BUILDING")],
          versions: [
            craftedVersion(1, { status: "FAILED" }),
            craftedVersion(2, { status: "FAILED", changeId: "c9" }),
          ],
        }),
        complete(1, 5),
        complete(2, 6),
      );
      expect(crafted.state.global.liveVersion).toBe(2);
      expect(version(crafted, 1).status).toBe("PREVIOUS");
      expect(change(crafted, "c9").status).toBe("BUILDING");
      expect(change(crafted, "c9").metrics.liveAt).toBeNull();
    });

    it("works for a change without a planned LIVE step", () => {
      const doc = apply(
        withState({ changes: [craftedChange("c5", "READY")] }),
        startLaunch({ number: 1, changeId: "c5", at: at(1) }),
        complete(1, 2),
      );
      expect(lastError(doc)).toBeNull();
      expect(change(doc, "c5").status).toBe("LAUNCHED");
      expect(change(doc, "c5").steps.map((s) => s.kind)).toEqual(["TESTS"]);
    });
  });

  describe("FAIL_LAUNCH", () => {
    it("failed launch keeps the live version", () => {
      const base = readyChange(live(), "c2", 20);
      const doc = apply(
        base,
        startLaunch({ number: 2, changeId: "c2", at: at(25) }),
        setLaunchLine({ number: 2, kind: "DEPLOY", status: "FAILED" }),
        failLaunch({
          number: 2,
          reason: "the new version didn't start",
          at: at(26),
        }),
      );
      expect(lastError(doc)).toBeNull();
      const s = doc.state.global;
      expect(s.liveVersion).toBe(1);
      expect(version(doc, 1).status).toBe("LIVE");
      expect(version(doc, 2)).toMatchObject({
        status: "FAILED",
        failure: "the new version didn't start",
      });
      expect(change(doc, "c2").status).toBe("READY");
      expect(step(doc, "LIVE", "c2")).toMatchObject({
        status: "STOPPED",
        reason: "the new version didn't start",
        updatedAt: at(26),
      });
    });

    it("a retry reuses the failed number and resets its lines", () => {
      const doc = apply(
        ready(),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
        setLaunchLine({ number: 1, kind: "SNAPSHOT", status: "DONE" }),
        failLaunch({ number: 1, reason: "publishing failed", at: at(10) }),
        requestLaunch({ changeId: "c1", requestedAt: at(11), requestedBy: by }),
        clearRequest({}),
        startLaunch({ number: 1, changeId: "c1", at: at(12) }),
      );
      expect(lastError(doc)).toBeNull();
      expect(doc.state.global.versions).toHaveLength(1);
      expect(version(doc, 1)).toMatchObject({
        status: "LAUNCHING",
        failure: null,
      });
      expect(version(doc, 1).lines.every((l) => l.status === "WAITING")).toBe(
        true,
      );
      expect(step(doc, "LIVE")).toMatchObject({
        status: "WORKING",
        reason: null,
      });

      // While the failed version waits, no other number is accepted (no gaps).
      const next = apply(
        ready(),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
        failLaunch({ number: 1, reason: "r", at: at(10) }),
        startLaunch({ number: 2, changeId: "c1", at: at(11) }),
      );
      expect(lastError(next)).toBe(
        "Version 2 can't be launched; the next version is 1.",
      );
      expect(next.state.global.versions.map((v) => v.number)).toEqual([1]);
    });

    it("a failed version older than a launched one doesn't block the next number", () => {
      // Written by an earlier build: Version 1 failed, Version 2 went live.
      const doc = apply(
        withState({
          changes: [craftedChange("c4", "READY")],
          liveVersion: 2,
          versions: [
            craftedVersion(1, { status: "FAILED" }),
            craftedVersion(2, { status: "LIVE" }),
          ],
        }),
        startLaunch({ number: 1, changeId: "c4", at: at(1) }),
        complete(1, 2),
        startLaunch({ number: 3, changeId: "c4", at: at(3) }),
      );
      expect(errorAt(doc, 0)).toBe(
        "Version 1 can't be launched; the next version is 3.",
      );
      expect(errorAt(doc, 1)).toBe(
        "Version 1 failed and is older than the live Version 2.",
      );
      expect(errorAt(doc, 2)).toBeNull();
      expect(doc.state.global.liveVersion).toBe(2);
      expect(version(doc, 3).status).toBe("LAUNCHING");
    });

    it("with several waiting failed versions, the lowest is retried first", () => {
      const doc = apply(
        withState({
          changes: [craftedChange("c4", "READY")],
          liveVersion: 1,
          versions: [
            craftedVersion(1, { status: "LIVE" }),
            craftedVersion(3, { status: "FAILED" }),
            craftedVersion(2, { status: "FAILED" }),
            craftedVersion(4, { status: "FAILED" }),
          ],
        }),
        startLaunch({ number: 3, changeId: "c4", at: at(1) }),
        setLiveVersion({ number: 1, at: at(2) }),
        startLaunch({ number: 2, changeId: "c4", at: at(3) }),
      );
      expect(errorAt(doc, 0)).toBe(
        "Version 3 can't be launched; the next version is 2.",
      );
      // A version recorded without a deployment leaves the deployment unknown.
      expect(errorAt(doc, 1)).toBeNull();
      expect(doc.state.global.liveDeploymentId).toBeNull();
      expect(errorAt(doc, 2)).toBeNull();
      expect(version(doc, 2).status).toBe("LAUNCHING");
    });

    it("is refused for a version that isn't launching or doesn't exist", () => {
      const base = live();
      const doc = apply(
        base,
        failLaunch({ number: 1, reason: "r", at: at(11) }),
        failLaunch({ number: 5, reason: "r", at: at(11) }),
      );
      const i = base.operations.global.length;
      expect(errorAt(doc, i)).toBe(
        "Version 1 is LIVE; only a launching version can fail.",
      );
      expect(errorAt(doc, i + 1)).toBe("No version 5 exists.");
      expect(doc.state.global.liveVersion).toBe(1);
    });

    it("leaves a change that is no longer launching alone", () => {
      const doc = apply(
        withState({
          changes: [craftedChange("c3", "PAUSED")],
          versions: [craftedVersion(1, { changeId: "c3" })],
        }),
        failLaunch({ number: 1, reason: "r", at: at(1) }),
      );
      expect(version(doc, 1).status).toBe("FAILED");
      expect(change(doc, "c3").status).toBe("PAUSED");
    });
  });

  describe("SET_LIVE_VERSION", () => {
    it("rollback marks the target LIVE and keeps every version", () => {
      const doc = apply(
        twoVersions(),
        setLiveVersion({ number: 1, at: at(40) }),
      );
      expect(lastError(doc)).toBeNull();
      const s = doc.state.global;
      expect(s.liveVersion).toBe(1);
      // "Deployed N min ago" counts from the rollback, on Version 1's deployment.
      expect(s.liveSince).toBe(at(40));
      expect(s.liveDeploymentId).toBe("dep-1");
      expect(s.versions.map((v) => [v.number, v.status])).toEqual([
        [1, "LIVE"],
        [2, "PREVIOUS"],
      ]);
      // Nothing about the launched versions is lost.
      expect(version(doc, 2)).toMatchObject({
        sha: "sha-2",
        deploymentId: "dep-2",
        launchedAt: at(31),
      });
      // Going forward again works the same way.
      const back = apply(
        doc,
        setLiveVersion({ number: 2, at: at(41), deploymentId: "dep-9" }),
      );
      expect(back.state.global.liveVersion).toBe(2);
      expect(back.state.global.liveSince).toBe(at(41));
      expect(back.state.global.liveDeploymentId).toBe("dep-9");
      expect(version(back, 1).status).toBe("PREVIOUS");
    });

    it("is refused for a version that never went live or doesn't exist", () => {
      const base = apply(
        readyChange(live(), "c2", 20),
        startLaunch({ number: 2, changeId: "c2", at: at(25) }),
      );
      const doc = apply(
        base,
        setLiveVersion({ number: 2, at: at(26) }),
        setLiveVersion({ number: 9, at: at(26) }),
        setLiveVersion({ number: 1, at: at(26) }),
      );
      const i = base.operations.global.length;
      expect(errorAt(doc, i)).toBe(
        "Version 2 is LAUNCHING; only a version that was live can be made live again.",
      );
      expect(errorAt(doc, i + 1)).toBe("No version 9 exists.");
      // Re-marking the live version is a no-op, not an error.
      expect(errorAt(doc, i + 2)).toBeNull();
      expect(doc.state.global.liveVersion).toBe(1);
    });
  });

  describe("health and permission", () => {
    it("SET_HEALTH and SET_LAUNCH_PERMISSION record their state", () => {
      const doc = apply(
        utils.createDocument(),
        setHealth({ health: "UNHEALTHY", at: at(1) }),
        setLaunchPermission({ state: "EXPIRED" }),
      );
      expect(doc.state.global.health).toBe("UNHEALTHY");
      expect(doc.state.global.launchPermission).toBe("EXPIRED");
    });
  });

  describe("COMPLETE_STEP LIVE", () => {
    it("is refused until the live version is this change's launch", () => {
      const doc = apply(
        ready(),
        completeStep({ changeId: "c1", kind: "LIVE", at: at(9) }),
      );
      expect(lastError(doc)).toBe(
        "Live can't be done: the change has not gone live.",
      );
      expect(step(doc, "LIVE").status).toBe("NOT_STARTED");

      // A LAUNCHED change is closed for step work.
      const launched = apply(
        live(),
        completeStep({ changeId: "c1", kind: "LIVE", at: at(11) }),
      );
      expect(lastError(launched)).toBe(
        'Change "c1" is LAUNCHED and can no longer be worked on.',
      );
    });

    it("passes when the live version comes from the change", () => {
      const live1 = craftedChange("c7", "READY", {
        steps: [
          {
            kind: "LIVE",
            status: "WORKING",
            done: null,
            total: null,
            label: null,
            reason: null,
            updatedAt: null,
          },
        ],
      });
      const doc = apply(
        withState({
          changes: [live1],
          liveVersion: 1,
          versions: [craftedVersion(1, { status: "LIVE", changeId: "c7" })],
        }),
        completeStep({ changeId: "c7", kind: "LIVE", at: at(3) }),
      );
      expect(lastError(doc)).toBeNull();
      expect(step(doc, "LIVE", "c7").status).toBe("DONE");
    });
  });

  describe("legacy documents", () => {
    /** A state from a build before versions, requests and health existed. */
    function legacyDoc(): StudioProductDocument {
      const legacy = {
        name: "Dog walks",
        idea: "plan dog walks",
        slug: "dog-walks",
        liveUrl: null,
        appId: null,
        productionEnvironmentId: null,
        productDriveId: null,
        access: "SIGNED_IN",
        changes: [
          {
            id: "c1",
            kind: "FIRST_BUILD",
            request: "plan dog walks",
            title: null,
            status: "READY",
            startedAt: at(1),
            steps: [{ kind: "TESTS", status: "DONE" }],
            milestones: [],
            checkRuns: [],
            metrics: { steps: 0 },
          },
        ],
        activeChangeId: "c1",
      };
      const doc = utils.createDocument();
      doc.state.global = JSON.parse(
        JSON.stringify(legacy),
      ) as StudioProductState;
      return doc;
    }

    const ops: StudioProductAction[] = [
      setLiveTarget({
        appId: "a",
        productionEnvironmentId: "e",
        slug: "dog-walks",
        liveUrl: "https://dog-walks.vetra.io",
      }),
      setProductDrive({ driveId: "phd:d" }),
      requestLaunch({ changeId: "c1", requestedAt: at(2), requestedBy: by }),
      requestRollback({
        versionNumber: 1,
        requestedAt: at(2),
        requestedBy: by,
      }),
      requestDiscard({ changeId: "c1", requestedAt: at(2), requestedBy: by }),
      requestRestart({ requestedAt: at(2), requestedBy: by }),
      requestMirror({ requestedAt: at(2), requestedBy: by }),
      clearRequest({}),
      startLaunch({ number: 1, changeId: "c1", at: at(2) }),
      setLaunchLine({ number: 1, kind: "DEPLOY", status: "DONE" }),
      complete(1, 3),
      failLaunch({ number: 1, reason: "r", at: at(3) }),
      setLiveVersion({ number: 1, at: at(3) }),
      setHealth({ health: "HEALTHY", at: at(3) }),
      setLaunchPermission({ state: "GRANTED" }),
    ];

    it.each(ops.map((a) => [a.type, a] as const))(
      "%s runs on a state missing the newer fields",
      (_type, action) => {
        const doc = apply(legacyDoc(), action);
        const error = doc.operations.global[0].error ?? null;
        if (error !== null) {
          expect(String(error)).toMatch(
            /still in progress|finish or discard|no live version|No version 1/,
          );
        }
        const s = doc.state.global;
        expect(Array.isArray(s.versions)).toBe(true);
        expect(s.changes[0].chatSessionIds).toEqual([]);
        expect(s.github.status).toBe("NOT_CONNECTED");
        expect(s.liveSince).toBeNull();
        expect(s.liveDeploymentId).toBeNull();
      },
    );
  });

  describe("scenario", () => {
    it("first launch → change → failed launch → retry → go back → restart", () => {
      let doc = apply(
        ready(),
        setLiveTarget({
          appId: "app-1",
          productionEnvironmentId: "env-1",
          slug: "dog-walks",
          liveUrl: "https://dog-walks.vetra.io",
        }),
        startLaunch({ number: 1, changeId: "c1", at: at(9) }),
        setLaunchLine({ number: 1, kind: "SNAPSHOT", status: "DONE" }),
        setLaunchLine({ number: 1, kind: "PUBLISH", status: "DONE" }),
        setLaunchLine({
          number: 1,
          kind: "DEPLOY",
          status: "DONE",
          detail: "dep-1",
        }),
        setProductDrive({
          driveId: "phd:drive-1",
          liveUrl: "https://dog-walks.vetra.io",
        }),
        setLaunchLine({ number: 1, kind: "VERIFY", status: "DONE" }),
        setLaunchLine({ number: 1, kind: "MIRROR", status: "SKIPPED" }),
        complete(1, 10),
        setHealth({ health: "HEALTHY", at: at(11) }),
      );
      doc = readyChange(doc, "c2", 20);
      doc = apply(
        doc,
        requestLaunch({ changeId: "c2", requestedAt: at(23), requestedBy: by }),
        clearRequest({}),
        startLaunch({ number: 2, changeId: "c2", at: at(24) }),
        failLaunch({
          number: 2,
          reason: "the new version didn't start",
          at: at(25),
        }),
        requestLaunch({ changeId: "c2", requestedAt: at(26), requestedBy: by }),
        clearRequest({}),
        startLaunch({ number: 2, changeId: "c2", at: at(27) }),
        complete(2, 28),
        requestRollback({
          versionNumber: 1,
          requestedAt: at(30),
          requestedBy: by,
        }),
        setLiveVersion({ number: 1, at: at(31) }),
        clearRequest({}),
        requestRestart({ requestedAt: at(32), requestedBy: by }),
      );
      expect(
        doc.operations.global.filter((o) => o.error).map((o) => o.error),
      ).toEqual([]);
      const s = doc.state.global;
      expect(s.liveVersion).toBe(1);
      expect(s.versions.map((v) => [v.number, v.status, v.changeId])).toEqual([
        [1, "LIVE", "c1"],
        [2, "PREVIOUS", "c2"],
      ]);
      expect(s.productDriveId).toBe("phd:drive-1");
      expect(s.health).toBe("HEALTHY");
      expect(version(doc, 1).lines.map((l) => l.status)).toEqual([
        "DONE",
        "DONE",
        "DONE",
        "DONE",
        "SKIPPED",
      ]);
      expect(version(doc, 1).lines[2].detail).toBe("dep-1");
      expect(change(doc, "c2").metrics.liveAt).toBe(at(28));
      expect(s.pendingRequest?.kind).toBe("RESTART");
    });
  });
});
