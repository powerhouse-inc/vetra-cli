import {
  addMilestone,
  adoptExisting,
  clearStuck,
  completeStep,
  countStep,
  discardChange,
  initProduct,
  markStuck,
  pauseChange,
  planSteps,
  recordChangeMetrics,
  recordCheckRun,
  reopenStep,
  resumeChange,
  setChangeTitle,
  setLiveBeforeVersions,
  setStepAttention,
  startChange,
  startStep,
  utils,
  waiveLint,
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

/** Complete PLAN, DATA, EDITORS with the runs their gates need. */
function throughEditors(doc = building()) {
  return apply(
    doc,
    completeStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
    run("r-gen", 3, { GENERATE: true }),
    completeStep({ changeId: "c1", kind: "DATA", at: at(4) }),
    run("r-smoke", 5, { SMOKE: true }),
    completeStep({ changeId: "c1", kind: "EDITORS", at: at(6) }),
  );
}

describe("START_CHANGE", () => {
  it("creates a BUILDING change and makes it active", () => {
    const doc = building();
    const c = change(doc);
    expect(doc.state.global.activeChangeId).toBe("c1");
    expect(c).toMatchObject({
      kind: "FIRST_BUILD",
      status: "BUILDING",
      chatSessionId: "phd:session-1",
      chatSessionIds: ["phd:session-1"],
      title: null,
      stuck: null,
      lintWaivedAt: null,
      milestones: [],
      checkRuns: [],
      metrics: { steps: 0, firstPreviewAt: null, readyAt: null, liveAt: null },
    });
  });

  it("without a chat session keeps the session lists empty", () => {
    const doc = apply(
      utils.createDocument(),
      startChange({ id: "c1", kind: "CHANGE", request: "r", startedAt: at(0) }),
    );
    expect(change(doc).chatSessionId).toBeNull();
    expect(change(doc).chatSessionIds).toEqual([]);
  });

  it("START_CHANGE while another change is building is rejected", () => {
    const doc = apply(
      building(),
      startChange({
        id: "c2",
        kind: "CHANGE",
        request: "more",
        startedAt: at(9),
      }),
    );
    expect(errorAt(doc, 3)).toMatch(/still in progress/);
    expect(doc.state.global.changes).toHaveLength(1);
    expect(doc.state.global.activeChangeId).toBe("c1");
  });

  it.each(["PAUSED", "READY", "LAUNCHING"] as const)(
    "is rejected while a change is %s",
    (status) => {
      const doc = apply(
        withState({ changes: [craftedChange("c0", status)] }),
        startChange({
          id: "c2",
          kind: "CHANGE",
          request: "r",
          startedAt: at(9),
        }),
      );
      expect(errorAt(doc, 0)).toMatch(/still in progress/);
    },
  );

  it("is allowed after a launched change and rejects a reused id", () => {
    const doc = apply(
      withState({ changes: [craftedChange("c0", "LAUNCHED")] }),
      startChange({ id: "c0", kind: "CHANGE", request: "r", startedAt: at(9) }),
      startChange({ id: "c1", kind: "CHANGE", request: "r", startedAt: at(9) }),
    );
    expect(errorAt(doc, 0)).toMatch(/already exists/);
    expect(errorAt(doc, 1)).toBeNull();
    expect(doc.state.global.activeChangeId).toBe("c1");
  });

  it("refuses BEFORE_VERSIONS (only ADOPT_EXISTING creates those)", () => {
    const doc = apply(
      utils.createDocument(),
      startChange({
        id: "c1",
        kind: "BEFORE_VERSIONS",
        request: "r",
        startedAt: at(0),
      }),
    );
    expect(errorAt(doc, 0)).toMatch(/ADOPT_EXISTING/);
    expect(doc.state.global.changes).toEqual([]);
  });
});

describe("ADOPT_EXISTING", () => {
  const adopt = adoptExisting({
    changeId: "c0",
    request: "Built before versions",
    chatSessionIds: ["phd:old-1", "phd:old-2"],
    doneSteps: ["PLAN", "DATA", "EDITORS"],
    at: at(0),
  });

  it("creates one CLOSED BEFORE_VERSIONS change without gates or an active change", () => {
    const doc = apply(utils.createDocument(), adopt);
    expect(errorAt(doc, 0)).toBeNull();
    const c = change(doc, "c0");
    expect(c).toMatchObject({
      kind: "BEFORE_VERSIONS",
      status: "CLOSED",
      chatSessionId: "phd:old-1",
      chatSessionIds: ["phd:old-1", "phd:old-2"],
      checkRuns: [],
    });
    expect(c.steps.map((s) => [s.kind, s.status])).toEqual([
      ["PLAN", "DONE"],
      ["DATA", "DONE"],
      ["EDITORS", "DONE"],
      ["TESTS", "NOT_STARTED"],
      ["LIVE", "NOT_STARTED"],
    ]);
    expect(step(doc, "DATA", "c0").updatedAt).toBe(at(0));
    expect(doc.state.global.activeChangeId).toBeNull();
  });

  it("without sessions leaves chatSessionId null", () => {
    const doc = apply(
      utils.createDocument(),
      adoptExisting({
        changeId: "c0",
        request: "r",
        chatSessionIds: [],
        doneSteps: [],
        at: at(0),
      }),
    );
    expect(change(doc, "c0").chatSessionId).toBeNull();
  });

  it("is rejected when the product already has changes", () => {
    const doc = apply(building(), adopt);
    expect(errorAt(doc, 3)).toMatch(/already has changes/);
    expect(doc.state.global.changes).toHaveLength(1);
  });

  it("a CLOSED change never blocks a new change, and cannot be worked on", () => {
    const doc = apply(
      utils.createDocument(),
      adopt,
      startStep({ changeId: "c0", kind: "TESTS", at: at(1) }),
      startChange({ id: "c1", kind: "CHANGE", request: "r", startedAt: at(2) }),
    );
    expect(errorAt(doc, 1)).toMatch(/CLOSED/);
    expect(errorAt(doc, 2)).toBeNull();
    expect(doc.state.global.activeChangeId).toBe("c1");
  });
});

describe("SET_LIVE_BEFORE_VERSIONS", () => {
  const live = setLiveBeforeVersions({
    environmentId: "env-old",
    url: "https://bold-crow-connect.vetra.io",
    at: at(1),
  });
  const adopt = adoptExisting({
    changeId: "c0",
    request: "Before versions",
    chatSessionIds: ["phd:old-1"],
    doneSteps: ["PLAN"],
    at: at(0),
  });

  it("records what was live before versions on an adopted product", () => {
    const doc = apply(utils.createDocument(), adopt, live);
    expect(errorAt(doc, 1)).toBeNull();
    expect(doc.state.global.liveBeforeVersions).toEqual({
      environmentId: "env-old",
      url: "https://bold-crow-connect.vetra.io",
      at: at(1),
    });
    // Nothing else moves: no live version, no live target.
    expect(doc.state.global.liveVersion).toBeNull();
    expect(doc.state.global.appId).toBeNull();
    expect(doc.state.global.liveUrl).toBeNull();
  });

  it("is refused on a product that was not adopted", () => {
    const doc = apply(building(), live);
    expect(lastError(doc)).toMatch(/adopted from before versions/);
    expect(doc.state.global.liveBeforeVersions).toBeNull();
  });

  it("is refused once the product has a version", () => {
    const doc = apply(
      withState({
        changes: [craftedChange("c0", "CLOSED", { kind: "BEFORE_VERSIONS" })],
        versions: [
          {
            number: 1,
            title: "t",
            summary: null,
            changeId: "c1",
            gitTag: "v1",
            sha: "s",
            packages: [],
            deploymentId: null,
            launchedAt: null,
            launchedBy: "vetra",
            trigger: "STUDIO_LAUNCH",
            status: "LAUNCHING",
            lines: [],
            changedFiles: [],
            failure: null,
            rollbackBlockedReason: null,
          },
        ],
      }),
      live,
    );
    expect(errorAt(doc, 0)).toMatch(/no version yet/);
    expect(doc.state.global.liveBeforeVersions).toBeNull();
  });
});

describe("PLAN_STEPS", () => {
  it("plans steps in order with totals", () => {
    const steps = change(building()).steps;
    expect(steps.map((s) => s.kind)).toEqual([
      "PLAN",
      "DATA",
      "EDITORS",
      "TESTS",
      "LIVE",
    ]);
    expect(steps[1]).toMatchObject({
      status: "NOT_STARTED",
      total: 3,
      done: null,
    });
  });

  it("re-planning keeps progress of kept steps and drops the others", () => {
    const doc = apply(
      building(),
      startStep({ changeId: "c1", kind: "DATA", label: "Models", at: at(2) }),
      countStep({ changeId: "c1", kind: "DATA", done: 1, total: 3 }),
      planSteps({
        changeId: "c1",
        steps: [
          { kind: "DATA", total: 4 },
          { kind: "EDITORS" },
          { kind: "TESTS" },
        ],
      }),
    );
    expect(lastError(doc)).toBeNull();
    expect(change(doc).steps.map((s) => s.kind)).toEqual([
      "DATA",
      "EDITORS",
      "TESTS",
    ]);
    expect(step(doc, "DATA")).toMatchObject({
      status: "WORKING",
      label: "Models",
      done: 1,
      total: 4,
    });
    expect(step(doc, "EDITORS").total).toBe(2);
  });

  it("rejects duplicate kinds, negative totals and totals below done", () => {
    const doc = apply(
      building(),
      planSteps({
        changeId: "c1",
        steps: [{ kind: "DATA" }, { kind: "DATA" }],
      }),
      planSteps({ changeId: "c1", steps: [{ kind: "DATA", total: -1 }] }),
      countStep({ changeId: "c1", kind: "DATA", done: 3, total: 3 }),
      planSteps({ changeId: "c1", steps: [{ kind: "DATA", total: 2 }] }),
    );
    expect(errorAt(doc, 3)).toMatch(/more than once/);
    expect(errorAt(doc, 4)).toMatch(/Invalid count/);
    expect(errorAt(doc, 5)).toBeNull();
    expect(errorAt(doc, 6)).toMatch(/Invalid count/);
    expect(change(doc).steps).toHaveLength(5);
  });

  it("rejects an unknown change", () => {
    const doc = apply(building(), planSteps({ changeId: "nope", steps: [] }));
    expect(lastError(doc)).toMatch(/No change "nope"/);
  });

  it("adding a step to a READY change sends it back to BUILDING", () => {
    const ready = apply(
      throughEditors(),
      allPassing("r-all", 7),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
    );
    expect(change(ready).status).toBe("READY");
    const doc = apply(
      ready,
      planSteps({
        changeId: "c1",
        steps: [
          { kind: "PLAN" },
          { kind: "DATA" },
          { kind: "EDITORS" },
          { kind: "TESTS" },
        ],
      }),
    );
    expect(change(doc).status).toBe("READY");
    const reopened = apply(
      withState({
        changes: [
          craftedChange("c1", "READY", {
            steps: [
              {
                kind: "PLAN",
                status: "DONE",
                done: null,
                total: null,
                label: null,
                reason: null,
                updatedAt: null,
              },
            ],
          }),
        ],
      }),
      planSteps({
        changeId: "c1",
        steps: [{ kind: "PLAN" }, { kind: "DATA" }],
      }),
    );
    expect(change(reopened).status).toBe("BUILDING");
  });

  it("dropping the last unfinished step makes the change READY", () => {
    const doc = apply(
      building(),
      completeStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
      planSteps({
        changeId: "c1",
        steps: [{ kind: "PLAN" }, { kind: "LIVE" }],
      }),
    );
    expect(change(doc).status).toBe("READY");
  });
});

describe("step progress", () => {
  it("START_STEP sets WORKING with label and time; label is kept when omitted", () => {
    const doc = apply(
      building(),
      startStep({
        changeId: "c1",
        kind: "DATA",
        label: "Shaping data",
        at: at(2),
      }),
      startStep({ changeId: "c1", kind: "DATA", at: at(3) }),
    );
    expect(step(doc, "DATA")).toMatchObject({
      status: "WORKING",
      label: "Shaping data",
      updatedAt: at(3),
    });
  });

  it("START_STEP on an unplanned step is rejected", () => {
    const doc = apply(
      utils.createDocument(),
      startChange({ id: "c1", kind: "CHANGE", request: "r", startedAt: at(0) }),
      planSteps({ changeId: "c1", steps: [{ kind: "DATA" }] }),
      startStep({ changeId: "c1", kind: "EDITORS", at: at(1) }),
    );
    expect(errorAt(doc, 2)).toMatch(/not planned/);
  });

  it("COUNT_STEP records counts and rejects invalid ones", () => {
    const doc = apply(
      building(),
      countStep({ changeId: "c1", kind: "DATA", done: 2, total: 3 }),
      countStep({ changeId: "c1", kind: "DATA", done: 4, total: 3 }),
      countStep({ changeId: "c1", kind: "DATA", done: -1, total: 3 }),
    );
    expect(errorAt(doc, 3)).toBeNull();
    expect(errorAt(doc, 4)).toMatch(/Invalid count/);
    expect(errorAt(doc, 5)).toMatch(/Invalid count/);
    expect(step(doc, "DATA")).toMatchObject({ done: 2, total: 3 });
  });

  it("COMPLETE_STEP fills the count, clears stuck and the reason", () => {
    const doc = apply(
      building(),
      setStepAttention({
        changeId: "c1",
        kind: "PLAN",
        status: "NEEDS_YOU",
        reason: "Waiting for you",
        at: at(2),
      }),
      markStuck({ changeId: "c1", reason: "loop", tried: ["a"], at: at(3) }),
      completeStep({ changeId: "c1", kind: "PLAN", at: at(4) }),
      run("r-gen", 5, { GENERATE: true }),
      completeStep({ changeId: "c1", kind: "DATA", at: at(6) }),
    );
    expect(change(doc).stuck).toBeNull();
    expect(step(doc, "PLAN")).toMatchObject({
      status: "DONE",
      reason: null,
      done: null,
      updatedAt: at(4),
    });
    expect(step(doc, "DATA")).toMatchObject({ status: "DONE", done: 3 });
  });

  it("REOPEN_STEP moves DONE back to WORKING with the reason", () => {
    const doc = apply(
      building(),
      completeStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
      reopenStep({
        changeId: "c1",
        kind: "PLAN",
        reason: "The customer asked for walkers",
        at: at(3),
      }),
      reopenStep({ changeId: "c1", kind: "DATA", reason: "x", at: at(4) }),
    );
    expect(step(doc, "PLAN")).toMatchObject({
      status: "WORKING",
      reason: "The customer asked for walkers",
      updatedAt: at(3),
    });
    expect(errorAt(doc, 5)).toMatch(/Only a DONE step/);
  });
});

describe("gates", () => {
  it("COMPLETE_STEP DATA needs GENERATE passed", () => {
    const doc = apply(
      building(),
      completeStep({ changeId: "c1", kind: "DATA", at: at(2) }),
      run("r1", 3, { GENERATE: false }),
      completeStep({ changeId: "c1", kind: "DATA", at: at(4) }),
      run("r2", 5, { GENERATE: true }),
      run("r3", 6, { GENERATE: false }),
      completeStep({ changeId: "c1", kind: "DATA", at: at(7) }),
      run("r4", 8, { GENERATE: true, TYPECHECK: false }),
      completeStep({ changeId: "c1", kind: "DATA", at: at(9) }),
    );
    expect(errorAt(doc, 3)).toMatch(/GENERATE/);
    expect(errorAt(doc, 5)).toMatch(/GENERATE/);
    expect(errorAt(doc, 8)).toMatch(/GENERATE/);
    expect(errorAt(doc, 10)).toBeNull();
    expect(step(doc, "DATA").status).toBe("DONE");
  });

  it("COMPLETE_STEP EDITORS needs SMOKE passed", () => {
    const doc = apply(
      building(),
      run("r1", 2, { SMOKE: false }),
      completeStep({ changeId: "c1", kind: "EDITORS", at: at(3) }),
      run("r2", 4, { SMOKE: true }),
      completeStep({ changeId: "c1", kind: "EDITORS", at: at(5) }),
    );
    expect(errorAt(doc, 4)).toMatch(/SMOKE/);
    expect(errorAt(doc, 6)).toBeNull();
  });

  it("COMPLETE_STEP TESTS without a passing check run in this change is rejected", () => {
    const earlier = craftedChange("c0", "LAUNCHED", {
      checkRuns: [
        {
          id: "r-old",
          at: at(0),
          results: [
            { kind: "GENERATE", passed: true, reason: null },
            { kind: "TYPECHECK", passed: true, reason: null },
            { kind: "LINT", passed: true, reason: null },
            { kind: "REDUCER_TESTS", passed: true, reason: null },
            { kind: "SMOKE", passed: true, reason: null },
          ],
        },
      ],
    });
    const doc = apply(
      withState({ changes: [earlier] }),
      startChange({ id: "c1", kind: "CHANGE", request: "r", startedAt: at(1) }),
      planSteps({ changeId: "c1", steps: [{ kind: "TESTS" }] }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(2) }),
    );
    expect(errorAt(doc, 2)).toMatch(/Tests can't be done/);
    expect(step(doc, "TESTS").status).toBe("NOT_STARTED");
  });

  it("COMPLETE_STEP TESTS after a run with all five kinds passed succeeds", () => {
    const doc = apply(
      throughEditors(),
      allPassing("r-all", 7),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
    );
    expect(lastError(doc)).toBeNull();
    expect(step(doc, "TESTS").status).toBe("DONE");
  });

  it("TESTS accepts the latest result of each kind across one-per-tool runs", () => {
    const doc = apply(
      building(),
      run("g", 2, { GENERATE: true }),
      run("t", 3, { TYPECHECK: false }),
      run("t2", 4, { TYPECHECK: true }),
      run("l", 5, { LINT: true }),
      run("u", 6, { REDUCER_TESTS: true }),
      run("s", 7, { SMOKE: true }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
    );
    expect(lastError(doc)).toBeNull();
  });

  it("TESTS rejects a missing kind and a failing latest result", () => {
    const doc = apply(
      building(),
      run("a", 2, { GENERATE: true, TYPECHECK: true, LINT: true, SMOKE: true }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(3) }),
      run("b", 4, { REDUCER_TESTS: true }),
      run("c", 5, { REDUCER_TESTS: false }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(6) }),
    );
    expect(errorAt(doc, 4)).toMatch(/REDUCER_TESTS/);
    expect(errorAt(doc, 7)).toMatch(/REDUCER_TESTS/);
  });

  it("TESTS rejects TYPECHECK or SMOKE older than the latest GENERATE", () => {
    const stale = apply(
      building(),
      allPassing("a", 2),
      run("g", 3, { GENERATE: true }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(4) }),
      run("t", 5, { TYPECHECK: true }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(6) }),
      run("s", 7, { SMOKE: true }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
    );
    expect(errorAt(stale, 5)).toMatch(/TYPECHECK.*older than GENERATE/);
    expect(errorAt(stale, 7)).toMatch(/SMOKE.*older than GENERATE/);
    expect(errorAt(stale, 9)).toBeNull();
  });

  it("latest is decided by time, not by recording order", () => {
    const doc = apply(
      building(),
      run("late", 9, { GENERATE: true }),
      run("early", 2, { GENERATE: false }),
      completeStep({ changeId: "c1", kind: "DATA", at: at(10) }),
    );
    expect(lastError(doc)).toBeNull();
  });

  it("LINT failing blocks TESTS until waived; a later failing LINT run blocks again", () => {
    const doc = apply(
      building(),
      run("a", 2, {
        GENERATE: true,
        TYPECHECK: true,
        LINT: false,
        REDUCER_TESTS: true,
        SMOKE: true,
      }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(3) }),
      waiveLint({ changeId: "c1", at: at(4) }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(5) }),
      reopenStep({ changeId: "c1", kind: "TESTS", reason: "more", at: at(6) }),
      run("b", 7, { LINT: false }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
    );
    expect(errorAt(doc, 4)).toMatch(/LINT/);
    expect(errorAt(doc, 5)).toBeNull();
    expect(change(doc).lintWaivedAt).toBe(at(4));
    expect(errorAt(doc, 6)).toBeNull();
    expect(errorAt(doc, 9)).toMatch(/LINT/);
  });

  it("PLAN has no gate; LIVE is refused until the change has gone live", () => {
    const doc = apply(
      building(),
      completeStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
      completeStep({ changeId: "c1", kind: "LIVE", at: at(3) }),
    );
    expect(step(doc, "PLAN").status).toBe("DONE");
    expect(errorAt(doc, 4)).toBe(
      "Live can't be done: the change has not gone live.",
    );
    expect(step(doc, "LIVE").status).toBe("NOT_STARTED");
    expect(change(doc).status).toBe("BUILDING");
  });
});

describe("WAIVE_LINT", () => {
  it("is rejected when nothing fails or when more than LINT fails", () => {
    const doc = apply(
      building(),
      waiveLint({ changeId: "c1", at: at(2) }),
      run("a", 3, { LINT: false, TYPECHECK: false }),
      waiveLint({ changeId: "c1", at: at(4) }),
      run("b", 5, { TYPECHECK: true }),
      waiveLint({ changeId: "c1", at: at(6) }),
    );
    expect(errorAt(doc, 3)).toMatch(/Nothing to waive/);
    expect(errorAt(doc, 5)).toMatch(/Nothing to waive/);
    expect(errorAt(doc, 7)).toBeNull();
    expect(change(doc).lintWaivedAt).toBe(at(6));
  });
});

describe("READY rule", () => {
  it.each(["FIRST_BUILD", "CHANGE", "UNDO"] as const)(
    "a %s change becomes READY when Plan Data Editors Tests are done",
    (kind) => {
      const before = apply(
        throughEditors(building(kind)),
        allPassing("r-all", 7),
      );
      expect(change(before).status).toBe("BUILDING");
      const doc = apply(
        before,
        completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
      );
      expect(change(doc).status).toBe("READY");
      expect(step(doc, "LIVE").status).toBe("NOT_STARTED");
    },
  );

  it("START_STEP and REOPEN_STEP on a READY change set it back to BUILDING", () => {
    const ready = apply(
      throughEditors(),
      allPassing("r-all", 7),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
    );
    const live = apply(
      ready,
      startStep({
        changeId: "c1",
        kind: "LIVE",
        label: "Going live",
        at: at(9),
      }),
    );
    expect(change(live).status).toBe("READY");

    const restarted = apply(
      ready,
      startStep({ changeId: "c1", kind: "EDITORS", at: at(9) }),
    );
    expect(change(restarted).status).toBe("BUILDING");
    expect(step(restarted, "EDITORS").status).toBe("WORKING");

    const reopened = apply(
      ready,
      reopenStep({
        changeId: "c1",
        kind: "DATA",
        reason: "Add walkers",
        at: at(9),
      }),
    );
    expect(change(reopened).status).toBe("BUILDING");
  });

  it("SET_STEP_ATTENTION on a READY change only reopens it for a non-LIVE step", () => {
    const ready = apply(
      throughEditors(),
      allPassing("r-all", 7),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(8) }),
    );
    const needsYou = apply(
      ready,
      setStepAttention({
        changeId: "c1",
        kind: "LIVE",
        status: "NEEDS_YOU",
        reason: "Your Studio needs your OK to publish.",
        at: at(9),
      }),
    );
    expect(change(needsYou).status).toBe("READY");
    expect(step(needsYou, "LIVE")).toMatchObject({
      status: "NEEDS_YOU",
      reason: "Your Studio needs your OK to publish.",
    });
    const working = apply(
      ready,
      setStepAttention({
        changeId: "c1",
        kind: "TESTS",
        status: "WORKING",
        at: at(9),
      }),
    );
    expect(change(working).status).toBe("BUILDING");
    expect(step(working, "TESTS").reason).toBeNull();
  });

  it("a paused change does not become READY until resumed", () => {
    const doc = apply(
      throughEditors(),
      allPassing("r-all", 7),
      pauseChange({ changeId: "c1", at: at(8) }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(9) }),
    );
    expect(change(doc).status).toBe("PAUSED");
    const resumed = apply(doc, resumeChange({ changeId: "c1", at: at(10) }));
    expect(change(resumed).status).toBe("READY");
  });
});

describe("story and attention", () => {
  it("ADD_MILESTONE appends, defaults recovered to false and clears stuck", () => {
    const doc = apply(
      building(),
      markStuck({
        changeId: "c1",
        reason: "build loop",
        tried: ["x", "y"],
        at: at(2),
      }),
      addMilestone({
        changeId: "c1",
        id: "m1",
        text: "Planned 3 things",
        at: at(3),
      }),
      addMilestone({
        changeId: "c1",
        id: "m2",
        text: "Fixed it",
        recovered: true,
        at: at(4),
      }),
      addMilestone({ changeId: "c1", id: "m1", text: "dup", at: at(5) }),
    );
    expect(change(doc).stuck).toBeNull();
    expect(change(doc).milestones).toEqual([
      { id: "m1", text: "Planned 3 things", at: at(3), recovered: false },
      { id: "m2", text: "Fixed it", at: at(4), recovered: true },
    ]);
    expect(lastError(doc)).toMatch(/already exists/);
  });

  it("MARK_STUCK and CLEAR_STUCK", () => {
    const stuck = apply(
      building(),
      markStuck({ changeId: "c1", reason: "loop", tried: ["a"], at: at(2) }),
    );
    expect(change(stuck).stuck).toEqual({
      reason: "loop",
      tried: ["a"],
      at: at(2),
    });
    const cleared = apply(stuck, clearStuck({ changeId: "c1" }));
    expect(change(cleared).stuck).toBeNull();
  });

  it("RECORD_CHECK_RUN rejects duplicate run ids and duplicate kinds in a run", () => {
    const doc = apply(
      building(),
      run("r1", 2, { GENERATE: true }),
      run("r1", 3, { GENERATE: true }),
      recordCheckRun({
        changeId: "c1",
        id: "r2",
        at: at(4),
        results: [
          { kind: "LINT", passed: true },
          { kind: "LINT", passed: false, reason: "2 errors" },
        ],
      }),
      recordCheckRun({
        changeId: "c1",
        id: "r3",
        at: at(5),
        results: [{ kind: "LINT", passed: true, reason: "3 warnings" }],
      }),
    );
    expect(errorAt(doc, 4)).toMatch(/already exists/);
    expect(errorAt(doc, 5)).toMatch(/more than once/);
    expect(change(doc).checkRuns.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(change(doc).checkRuns[1].results[0].reason).toBe("3 warnings");
  });

  it("SET_STEP_ATTENTION accepts only NEEDS_YOU, STOPPED and WORKING", () => {
    const doc = apply(
      building(),
      setStepAttention({
        changeId: "c1",
        kind: "DATA",
        status: "STOPPED",
        reason: "The AI service didn't respond.",
        at: at(2),
      }),
      setStepAttention({
        changeId: "c1",
        kind: "DATA",
        status: "DONE",
        at: at(3),
      }),
    );
    expect(step(doc, "DATA")).toMatchObject({
      status: "STOPPED",
      updatedAt: at(2),
    });
    expect(errorAt(doc, 4)).toMatch(/NEEDS_YOU, STOPPED or WORKING/);
  });
});

describe("pause, metrics, title", () => {
  it("PAUSE_CHANGE and RESUME_CHANGE enforce their source status", () => {
    const doc = apply(
      building(),
      resumeChange({ changeId: "c1", at: at(2) }),
      pauseChange({ changeId: "c1", at: at(3) }),
      pauseChange({ changeId: "c1", at: at(4) }),
      resumeChange({ changeId: "c1", at: at(5) }),
    );
    expect(errorAt(doc, 3)).toMatch(/BUILDING/);
    expect(errorAt(doc, 4)).toBeNull();
    expect(errorAt(doc, 5)).toMatch(/PAUSED/);
    expect(errorAt(doc, 6)).toBeNull();
    expect(change(doc).status).toBe("BUILDING");
  });

  it("RECORD_CHANGE_METRICS keeps timings that are not given", () => {
    const doc = apply(
      building(),
      recordChangeMetrics({ changeId: "c1", steps: 3, firstPreviewAt: at(4) }),
      recordChangeMetrics({ changeId: "c1", steps: 5, readyAt: at(9) }),
    );
    expect(change(doc).metrics).toEqual({
      steps: 5,
      firstPreviewAt: at(4),
      readyAt: at(9),
      liveAt: null,
    });
  });

  it("metrics and title can be recorded on a closed change", () => {
    const doc = apply(
      withState({ changes: [craftedChange("c1", "LAUNCHED")] }),
      recordChangeMetrics({ changeId: "c1", steps: 7 }),
      setChangeTitle({ changeId: "c1", title: "Walk planner" }),
      setChangeTitle({ changeId: "c9", title: "x" }),
    );
    expect(errorAt(doc, 0)).toBeNull();
    expect(errorAt(doc, 1)).toBeNull();
    expect(change(doc).title).toBe("Walk planner");
    expect(change(doc).metrics.steps).toBe(7);
    expect(errorAt(doc, 2)).toMatch(/No change "c9"/);
  });

  it("work on a launched change is rejected", () => {
    const doc = apply(
      withState({ changes: [craftedChange("c1", "LAUNCHED")] }),
      startStep({ changeId: "c1", kind: "TESTS", at: at(1) }),
      initProduct({ name: "n", idea: "i", createdAt: at(0) }),
    );
    expect(errorAt(doc, 0)).toMatch(/LAUNCHED/);
  });
});

describe("DISCARD_CHANGE", () => {
  it("closes an open change, stops its LIVE step and clears the active pointer", () => {
    const doc = apply(
      withState({
        changes: [
          craftedChange("c1", "READY", {
            steps: [
              {
                kind: "LIVE",
                status: "NOT_STARTED",
                done: null,
                total: null,
                label: null,
                reason: null,
                updatedAt: null,
              },
            ],
          }),
        ],
        activeChangeId: "c1",
      }),
      discardChange({ changeId: "c1", at: at(9) }),
    );
    expect(lastError(doc)).toBeNull();
    expect(change(doc).status).toBe("DISCARDED");
    expect(step(doc, "LIVE")).toMatchObject({
      status: "STOPPED",
      reason: null,
      updatedAt: at(9),
    });
    expect(doc.state.global.activeChangeId).toBeNull();
  });

  it("leaves another active change alone and works without a LIVE step", () => {
    const doc = apply(
      withState({
        changes: [craftedChange("c1", "BUILDING")],
        activeChangeId: "c2",
      }),
      discardChange({ changeId: "c1", at: at(9) }),
    );
    expect(lastError(doc)).toBeNull();
    expect(change(doc).status).toBe("DISCARDED");
    expect(doc.state.global.activeChangeId).toBe("c2");
  });

  it("keeps the change's story and lets the next change start (D13, D17)", () => {
    const doc = apply(
      utils.createDocument(),
      startChange({
        id: "c1",
        kind: "CHANGE",
        request: "Add a notes field",
        chatSessionId: "s1",
        startedAt: at(1),
      }),
      addMilestone({
        changeId: "c1",
        id: "m1",
        text: "Added notes",
        at: at(2),
      }),
      discardChange({ changeId: "c1", at: at(3) }),
      startChange({
        id: "c2",
        kind: "UNDO",
        request: "Undo the notes field",
        chatSessionId: "s2",
        startedAt: at(4),
      }),
    );
    expect(lastError(doc)).toBeNull();
    const [discarded, next] = doc.state.global.changes;
    expect(discarded).toMatchObject({
      id: "c1",
      status: "DISCARDED",
      request: "Add a notes field",
      chatSessionId: "s1",
      chatSessionIds: ["s1"],
    });
    expect(discarded.milestones.map((m) => m.text)).toEqual(["Added notes"]);
    expect(next).toMatchObject({
      id: "c2",
      status: "BUILDING",
      chatSessionId: "s2",
    });
    expect(doc.state.global.activeChangeId).toBe("c2");
  });

  it("refuses a change that is launching, already closed or unknown", () => {
    const launching = apply(
      withState({ changes: [craftedChange("c1", "LAUNCHING")] }),
      discardChange({ changeId: "c1", at: at(9) }),
    );
    const closed = apply(
      withState({ changes: [craftedChange("c1", "DISCARDED")] }),
      discardChange({ changeId: "c1", at: at(9) }),
    );
    const unknown = apply(
      withState({ changes: [] }),
      discardChange({ changeId: "zz", at: at(9) }),
    );
    expect(lastError(launching)).toBe(
      'Change "c1" is LAUNCHING and can\'t be discarded.',
    );
    expect(lastError(closed)).toBe(
      'Change "c1" is DISCARDED and can\'t be discarded.',
    );
    expect(lastError(unknown)).toBe('No change "zz" exists.');
  });
});
