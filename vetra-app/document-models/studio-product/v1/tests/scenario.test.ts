import {
  addMilestone,
  completeStep,
  countStep,
  initProduct,
  markStuck,
  planSteps,
  recordChangeMetrics,
  reopenStep,
  setChangeTitle,
  startChange,
  startStep,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import { apply, at, change, lastError, run, step } from "./helpers.js";

describe("first build scenario", () => {
  it("INIT → START_CHANGE → PLAN_STEPS → steps, counts, milestones, check runs → READY", () => {
    let doc = apply(
      utils.createDocument(),
      initProduct({
        name: "An app to plan",
        idea: "an app to plan dog walks with friends",
        createdAt: at(0),
      }),
      startChange({
        id: "c1",
        kind: "FIRST_BUILD",
        request: "an app to plan dog walks with friends",
        chatSessionId: "phd:session-1",
        startedAt: at(1),
      }),
      planSteps({
        changeId: "c1",
        steps: [
          { kind: "PLAN" },
          { kind: "DATA", total: 2 },
          { kind: "EDITORS", total: 1 },
          { kind: "TESTS" },
          { kind: "LIVE" },
        ],
      }),
      startStep({ changeId: "c1", kind: "PLAN", label: "Planning", at: at(1) }),
      setChangeTitle({ changeId: "c1", title: "Dog walk planner" }),
      addMilestone({
        changeId: "c1",
        id: "m1",
        text: "Planned 3 things",
        at: at(2),
      }),
      completeStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
      startStep({
        changeId: "c1",
        kind: "DATA",
        label: "Walks and walkers",
        at: at(3),
      }),
      countStep({ changeId: "c1", kind: "DATA", done: 1, total: 2 }),
      run("r1", 4, { GENERATE: true }),
      countStep({ changeId: "c1", kind: "DATA", done: 2, total: 2 }),
      completeStep({ changeId: "c1", kind: "DATA", at: at(5) }),
      addMilestone({
        changeId: "c1",
        id: "m2",
        text: "Walks can be saved",
        at: at(5),
      }),
      startStep({ changeId: "c1", kind: "EDITORS", at: at(6) }),
      run("r2", 7, { SMOKE: false }),
      markStuck({
        changeId: "c1",
        reason: "The preview doesn't load",
        tried: ["rebuilt", "restarted preview"],
        at: at(8),
      }),
      run("r3", 9, { SMOKE: true }),
      addMilestone({
        changeId: "c1",
        id: "m3",
        text: "Preview works again",
        recovered: true,
        at: at(9),
      }),
      completeStep({ changeId: "c1", kind: "EDITORS", at: at(10) }),
      startStep({ changeId: "c1", kind: "TESTS", at: at(11) }),
      run("r4", 12, { TYPECHECK: true }),
      run("r5", 12, { LINT: true }),
      run("r6", 13, { REDUCER_TESTS: true }),
      run("r7", 14, { SMOKE: true }),
      completeStep({ changeId: "c1", kind: "TESTS", at: at(15) }),
      recordChangeMetrics({
        changeId: "c1",
        steps: 4,
        firstPreviewAt: at(7),
        readyAt: at(15),
      }),
    );

    expect(doc.operations.global.filter((op) => op.error)).toEqual([]);
    const c = change(doc);
    expect(c.status).toBe("READY");
    expect(c.title).toBe("Dog walk planner");
    expect(c.stuck).toBeNull();
    expect(c.milestones.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(c.checkRuns).toHaveLength(7);
    expect(c.steps.map((s) => s.status)).toEqual([
      "DONE",
      "DONE",
      "DONE",
      "DONE",
      "NOT_STARTED",
    ]);
    expect(step(doc, "DATA")).toMatchObject({ done: 2, total: 2 });
    expect(c.metrics).toEqual({
      steps: 4,
      firstPreviewAt: at(7),
      readyAt: at(15),
      liveAt: null,
    });

    // "Keep changing": the agent returns to Data; the Ready bar goes away.
    doc = apply(
      doc,
      reopenStep({
        changeId: "c1",
        kind: "DATA",
        reason: "Add a walker's phone number",
        at: at(16),
      }),
    );
    expect(change(doc).status).toBe("BUILDING");
    expect(step(doc, "DATA")).toMatchObject({
      status: "WORKING",
      reason: "Add a walker's phone number",
    });

    // The next change is blocked while this one is still in progress.
    doc = apply(
      doc,
      startChange({
        id: "c2",
        kind: "CHANGE",
        request: "Add photos",
        startedAt: at(17),
      }),
    );
    expect(lastError(doc)).toMatch(/still in progress/);
  });
});
