import {
  addMilestone,
  answerQuestion,
  askQuestion,
  completeStep,
  countStep,
  finishRowImport,
  initProduct,
  keepVariant,
  markStuck,
  planSteps,
  recordChangeMetrics,
  reopenStep,
  setChangeCost,
  setChangeTitle,
  setGuidedLoop,
  setOrigin,
  setUnderstood,
  setUpstreamVersion,
  setVariantStatus,
  startChange,
  startRowImport,
  startStep,
  startVariants,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import {
  apply,
  at,
  building,
  change,
  lastError,
  run,
  step,
} from "./helpers.js";

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

describe("iterate scenarios", () => {
  it("variants: start → A ready → B ready → keep B", () => {
    let doc = apply(
      building("CHANGE"),
      startVariants({
        changeId: "c1",
        branchA: "vetra/variants/c1-a",
        branchB: "vetra/variants/c1-b",
      }),
      setVariantStatus({
        changeId: "c1",
        label: "A",
        status: "READY",
        chatSessionId: "phd:session-a",
        summary: "Tags as chips under the title",
      }),
    );
    expect(change(doc).variants.map((v) => v.status)).toEqual([
      "READY",
      "BUILDING",
    ]);
    doc = apply(
      doc,
      setVariantStatus({
        changeId: "c1",
        label: "B",
        status: "READY",
        chatSessionId: "phd:session-b",
        summary: "Tags in a side panel",
      }),
      keepVariant({ changeId: "c1", label: "B" }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    expect(change(doc).variants).toEqual([
      {
        label: "A",
        branch: "vetra/variants/c1-a",
        status: "DISCARDED",
        chatSessionId: "phd:session-a",
        summary: "Tags as chips under the title",
      },
      {
        label: "B",
        branch: "vetra/variants/c1-b",
        status: "KEPT",
        chatSessionId: "phd:session-b",
        summary: "Tags in a side panel",
      },
    ]);
    // Once one is kept, a new pair can't start until both are discarded.
    doc = apply(
      doc,
      startVariants({ changeId: "c1", branchA: "x", branchB: "y" }),
    );
    expect(lastError(doc)).toBe('Change "c1" already has variants.');
  });

  it("remix origin then upstream version", () => {
    const doc = apply(
      utils.createDocument(),
      initProduct({
        name: "Notes",
        idea: "start from knowledge-note",
        createdAt: at(0),
      }),
      setOrigin({
        packageName: "@powerhousedao/knowledge-note",
        version: "1.0.0",
        mode: "REMIX",
        license: "AGPL-3.0",
        sourceUrl: "https://github.com/apeiron-M/bai-knowledge-note",
        missing: [],
        at: at(1),
      }),
      setUpstreamVersion({
        packageName: "@powerhousedao/knowledge-note",
        latestVersion: "1.1.0",
        checkedAt: at(2),
      }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    expect(doc.state.global.origins).toEqual([
      {
        packageName: "@powerhousedao/knowledge-note",
        version: "1.0.0",
        mode: "REMIX",
        license: "AGPL-3.0",
        sourceUrl: "https://github.com/apeiron-M/bai-knowledge-note",
        sourceRef: null,
        at: at(1),
        missing: [],
        latestVersion: "1.1.0",
        checkedAt: at(2),
      },
    ]);
  });
});

describe("workshop scenarios", () => {
  it("workshop: understood → build → question answered by default → cost recorded → rows imported", () => {
    const understood = JSON.stringify({ title: "Dog walks", things: ["Dog"] });
    let doc = apply(
      utils.createDocument(),
      initProduct({
        name: "Dog walks",
        idea: "plan dog walks with friends",
        createdAt: at(0),
      }),
      setUnderstood({
        json: understood,
        language: "de",
        at: at(1),
        materials: [{ id: "mat-1", name: "dogs.xlsx", kind: "SHEET" }],
      }),
      // "Build this"
      startChange({
        id: "c1",
        kind: "FIRST_BUILD",
        request: "plan dog walks with friends",
        startedAt: at(2),
      }),
      setChangeCost({ changeId: "c1", startUsd: 0.5 }),
      askQuestion({
        changeId: "c1",
        id: "q1",
        text: "Soll ein Spaziergang eine feste Dauer haben?",
        options: ["Ja", "Nein"],
        defaultAnswer: "Nein",
        language: "de",
        askedAt: at(3),
      }),
      // Nobody answered in time: the default stands.
      answerQuestion({
        changeId: "c1",
        id: "q1",
        answer: "Nein",
        answeredBy: "DEFAULT",
        answeredAt: at(4),
      }),
      setChangeCost({ changeId: "c1", endUsd: 1.75 }),
      startRowImport({
        id: "ri1",
        materialId: "mat-1",
        sheet: "Hunde",
        documentType: "acme/dog",
        rows: 8,
        at: at(5),
      }),
      finishRowImport({ id: "ri1", imported: 8, status: "DONE", at: at(6) }),
      setGuidedLoop({ status: "POINTED", at: at(7) }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    const state = doc.state.global;
    expect(state.understood).toEqual({
      json: understood,
      language: "de",
      at: at(1),
      materials: [{ id: "mat-1", name: "dogs.xlsx", kind: "SHEET" }],
    });
    expect(change(doc).questions[0]).toMatchObject({
      answer: "Nein",
      answeredBy: "DEFAULT",
      answeredAt: at(4),
    });
    expect(change(doc).cost).toEqual({ startUsd: 0.5, endUsd: 1.75 });
    expect(state.rowImports[0]).toMatchObject({
      id: "ri1",
      rows: 8,
      imported: 8,
      status: "DONE",
    });
    expect(state.guidedLoop).toEqual({ status: "POINTED", at: at(7) });

    // The room can't answer again after the default was taken.
    doc = apply(
      doc,
      answerQuestion({
        changeId: "c1",
        id: "q1",
        answer: "Ja",
        answeredBy: "ROOM",
        answeredAt: at(8),
      }),
    );
    expect(lastError(doc)).toBe('Question "q1" was already answered.');
  });
});
