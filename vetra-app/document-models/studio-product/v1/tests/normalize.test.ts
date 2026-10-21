import type {
  StudioProductAction,
  StudioProductDocument,
  StudioProductState,
} from "document-models/studio-product/v1";
import {
  addMilestone,
  adoptExisting,
  clearStuck,
  completeStep,
  countStep,
  initProduct,
  markStuck,
  normalizeProduct,
  pauseChange,
  planSteps,
  recordChangeMetrics,
  recordCheckRun,
  renameProduct,
  reopenStep,
  resumeChange,
  setAccess,
  setChangeTitle,
  setStepAttention,
  startChange,
  startStep,
  utils,
  waiveLint,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import { apply, at, results } from "./helpers.js";

/**
 * A document written by a build that predates the complete state: no
 * createdAt, versions, health, pendingRequest, launchPermission, suggestions,
 * github, liveVersion; changes without chatSessionIds, lintWaivedAt or
 * metrics.liveAt.
 */
function legacyState(withChange: boolean): StudioProductState {
  const legacyChange = {
    id: "c1",
    kind: "FIRST_BUILD",
    request: "plan dog walks",
    title: null,
    chatSessionId: "phd:session-1",
    status: "BUILDING",
    startedAt: at(1),
    steps: [
      { kind: "PLAN", status: "WORKING", updatedAt: at(1) },
      { kind: "DATA", status: "NOT_STARTED", total: 3 },
      { kind: "TESTS", status: "NOT_STARTED" },
    ],
    milestones: [{ id: "m0", text: "Started", at: at(1), recovered: false }],
    checkRuns: [
      { id: "r0", at: at(1), results: [{ kind: "LINT", passed: false }] },
    ],
    metrics: { steps: 0 },
  };
  const legacy = {
    name: "Dog walks",
    idea: "plan dog walks",
    slug: null,
    liveUrl: null,
    appId: null,
    productionEnvironmentId: null,
    productDriveId: null,
    access: "SIGNED_IN",
    changes: withChange ? [legacyChange] : [],
    activeChangeId: withChange ? "c1" : null,
  };
  return JSON.parse(JSON.stringify(legacy)) as StudioProductState;
}

function legacyDoc(withChange = true): StudioProductDocument {
  const doc = utils.createDocument();
  doc.state.global = legacyState(withChange);
  return doc;
}

const changeOps: StudioProductAction[] = [
  planSteps({
    changeId: "c1",
    steps: [{ kind: "PLAN" }, { kind: "DATA", total: 3 }],
  }),
  startStep({ changeId: "c1", kind: "DATA", at: at(2) }),
  countStep({ changeId: "c1", kind: "DATA", done: 1, total: 3 }),
  completeStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
  reopenStep({ changeId: "c1", kind: "PLAN", reason: "r", at: at(3) }),
  addMilestone({ changeId: "c1", id: "m1", text: "t", at: at(3) }),
  recordCheckRun({
    changeId: "c1",
    id: "r1",
    at: at(3),
    results: results({ GENERATE: true }),
  }),
  markStuck({ changeId: "c1", reason: "r", tried: [], at: at(3) }),
  clearStuck({ changeId: "c1" }),
  setStepAttention({
    changeId: "c1",
    kind: "DATA",
    status: "NEEDS_YOU",
    at: at(3),
  }),
  waiveLint({ changeId: "c1", at: at(4) }),
  pauseChange({ changeId: "c1", at: at(4) }),
  resumeChange({ changeId: "c1", at: at(4) }),
  recordChangeMetrics({ changeId: "c1", steps: 2 }),
  setChangeTitle({ changeId: "c1", title: "t" }),
  renameProduct({ name: "n" }),
  setAccess({ access: "OWNER_ONLY" }),
  initProduct({ name: "n", idea: "i", createdAt: at(0) }),
  startChange({ id: "c2", kind: "CHANGE", request: "r", startedAt: at(5) }),
];

describe("legacy documents", () => {
  it.each(changeOps.map((a) => [a.type, a] as const))(
    "%s runs on a state missing the newer fields",
    (_type, action) => {
      const doc = apply(legacyDoc(), action);
      const error = doc.operations.global[0].error ?? null;
      // Only domain errors are allowed, never a crash on a missing field.
      if (error !== null) {
        expect(String(error)).toMatch(
          /already initialised|still in progress|Only a DONE step|only a PAUSED change/,
        );
      }
      const state = doc.state.global;
      expect(state.versions).toEqual([]);
      expect(state.suggestions).toEqual([]);
      expect(state.health).toBe("UNKNOWN");
      expect(state.launchPermission).toBe("UNKNOWN");
      expect(state.github.status).toBe("NOT_CONNECTED");
      const c = state.changes[0];
      expect(c.chatSessionIds).toEqual(["phd:session-1"]);
      expect(c.metrics.liveAt).toBeNull();
    },
  );

  it("ADOPT_EXISTING and INIT_PRODUCT run on an empty legacy state", () => {
    const doc = apply(
      legacyDoc(false),
      adoptExisting({
        changeId: "c0",
        request: "r",
        chatSessionIds: [],
        doneSteps: ["PLAN"],
        at: at(0),
      }),
    );
    expect(doc.operations.global[0].error ?? null).toBeNull();
    expect(doc.state.global.changes[0].status).toBe("CLOSED");
  });
});

describe("normalizeProduct", () => {
  it("fills every missing list and default in place and returns the state", () => {
    const state = legacyState(true);
    const out = normalizeProduct(state);
    expect(out).toBe(state);
    expect(out).toMatchObject({
      createdAt: null,
      liveVersion: null,
      liveSince: null,
      liveDeploymentId: null,
      versions: [],
      health: "UNKNOWN",
      pendingRequest: null,
      launchPermission: "UNKNOWN",
      suggestions: [],
      github: {
        status: "NOT_CONNECTED",
        repoFullName: null,
        lastError: null,
        externalChangesSha: null,
      },
    });
    const c = out.changes[0];
    expect(c).toMatchObject({
      chatSessionIds: ["phd:session-1"],
      lintWaivedAt: null,
      stuck: null,
      metrics: { steps: 0, firstPreviewAt: null, readyAt: null, liveAt: null },
    });
    expect(c.steps[1]).toEqual({
      kind: "DATA",
      status: "NOT_STARTED",
      done: null,
      total: 3,
      label: null,
      reason: null,
      updatedAt: null,
    });
    expect(c.checkRuns[0].results[0].reason).toBeNull();
  });

  it("fills a bare object and nested partial records", () => {
    const bare = JSON.parse(
      JSON.stringify({
        changes: [
          {
            id: "c1",
            kind: "CHANGE",
            request: "r",
            status: "BUILDING",
            startedAt: at(0),
          },
        ],
        versions: [
          {
            number: 1,
            title: "v1",
            gitTag: "v1",
            sha: "abc",
            launchedBy: "me",
            trigger: "auto",
            status: "LIVE",
            lines: [{ kind: "SNAPSHOT", status: "DONE" }],
          },
        ],
        github: { status: "CONNECTED", repoFullName: "o/r" },
      }),
    ) as StudioProductState;
    const out = normalizeProduct(bare);
    expect(out).toMatchObject({
      name: null,
      idea: null,
      access: "SIGNED_IN",
      activeChangeId: null,
      github: { status: "CONNECTED", repoFullName: "o/r", lastError: null },
    });
    expect(out.changes[0]).toMatchObject({
      title: null,
      chatSessionId: null,
      chatSessionIds: [],
      steps: [],
      milestones: [],
      checkRuns: [],
      metrics: { steps: 0, liveAt: null },
    });
    expect(out.versions[0]).toMatchObject({
      summary: null,
      changeId: null,
      packages: [],
      deploymentId: null,
      launchedAt: null,
      lines: [{ kind: "SNAPSHOT", status: "DONE", detail: null }],
      changedFiles: [],
      failure: null,
      rollbackBlockedReason: null,
    });
  });

  it("leaves a complete state unchanged", () => {
    const fresh = utils.createDocument().state.global;
    const copy = JSON.parse(JSON.stringify(fresh)) as StudioProductState;
    expect(normalizeProduct(copy)).toEqual(fresh);
  });
});
