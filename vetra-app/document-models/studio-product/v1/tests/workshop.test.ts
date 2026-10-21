import type {
  GuidedLoopStatus,
  StudioProductDocument,
} from "document-models/studio-product/v1";
import {
  answerQuestion,
  askQuestion,
  finishRowImport,
  isStudioProductDocument,
  markExplainersSeen,
  setChangeCost,
  setGuidedLoop,
  setUnderstood,
  startRowImport,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import { apply, at, building, change, errorAt } from "./helpers.js";

const UNDERSTOOD = JSON.stringify({
  title: "Dog walks",
  things: [{ name: "Walk", fields: ["when", "where"] }],
});

const MATERIALS = [
  { id: "mat-1", name: "whiteboard.jpg", kind: "PICTURE" as const },
  { id: "mat-2", name: "dogs.xlsx", kind: "SHEET" as const },
];

const QUESTION = {
  changeId: "c1",
  id: "q1",
  text: "Should a walk have a fixed length?",
  options: ["Yes", "No"],
  defaultAnswer: "No",
  language: "en",
  askedAt: at(2),
};

function asked(): StudioProductDocument {
  return apply(building(), askQuestion(QUESTION));
}

function rowImport(): StudioProductDocument {
  return apply(
    utils.createDocument(),
    startRowImport({
      id: "ri1",
      materialId: "mat-2",
      sheet: "Dogs",
      documentType: "acme/dog",
      rows: 12,
      at: at(3),
    }),
  );
}

describe("SET_UNDERSTOOD", () => {
  it("stores the understanding with its materials and replaces an earlier one", () => {
    const doc = apply(
      utils.createDocument(),
      setUnderstood({
        json: "{}",
        language: "de",
        at: at(1),
        materials: [],
      }),
      setUnderstood({
        json: UNDERSTOOD,
        language: "en",
        at: at(2),
        materials: MATERIALS,
      }),
    );
    expect(isStudioProductDocument(doc)).toBe(true);
    expect(errorAt(doc, 0)).toBeNull();
    expect(errorAt(doc, 1)).toBeNull();
    expect(doc.state.global.understood).toEqual({
      json: UNDERSTOOD,
      language: "en",
      at: at(2),
      materials: MATERIALS,
    });
  });

  it.each([
    ["not JSON", "{not json"],
    ["an array", "[1, 2]"],
    ["null", "null"],
    ["a string", '"text"'],
    ["over 200 000 characters", JSON.stringify({ x: "a".repeat(200_000) })],
  ])("refuses an understanding that is %s (state unchanged)", (_, json) => {
    const doc = apply(
      utils.createDocument(),
      setUnderstood({ json, language: "en", at: at(1), materials: [] }),
    );
    expect(errorAt(doc, 0)).toMatch(/JSON object/);
    expect(doc.state.global.understood).toBeNull();
  });

  it("refuses a language other than de or en (state unchanged)", () => {
    const doc = apply(
      utils.createDocument(),
      setUnderstood({
        json: UNDERSTOOD,
        language: "fr",
        at: at(1),
        materials: [],
      }),
    );
    expect(errorAt(doc, 0)).toBe('The language is "de" or "en", not "fr".');
    expect(doc.state.global.understood).toBeNull();
  });
});

describe("MARK_EXPLAINERS_SEEN", () => {
  it("adds unseen ids in order and ignores known ones", () => {
    const doc = apply(
      utils.createDocument(),
      markExplainersSeen({ ids: ["preview", "steps"] }),
      markExplainersSeen({ ids: ["steps", "versions", "versions", "preview"] }),
      markExplainersSeen({ ids: [] }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    expect(doc.state.global.explainersSeen).toEqual([
      "preview",
      "steps",
      "versions",
    ]);
  });
});

describe("SET_GUIDED_LOOP", () => {
  it("moves forward one step at a time to DONE", () => {
    const doc = apply(
      utils.createDocument(),
      setGuidedLoop({ status: "POINTED", at: at(1) }),
      setGuidedLoop({ status: "CHANGED", at: at(2) }),
      setGuidedLoop({ status: "WENT_BACK", at: at(3) }),
      setGuidedLoop({ status: "DONE", at: at(4) }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    expect(doc.state.global.guidedLoop).toEqual({ status: "DONE", at: at(4) });
  });

  it("may skip ahead", () => {
    const doc = apply(
      utils.createDocument(),
      setGuidedLoop({ status: "CHANGED", at: at(1) }),
      setGuidedLoop({ status: "DONE", at: at(2) }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    expect(doc.state.global.guidedLoop).toEqual({ status: "DONE", at: at(2) });
  });

  it.each<[GuidedLoopStatus[]]>([
    [[]],
    [["POINTED"]],
    [["POINTED", "CHANGED", "WENT_BACK"]],
  ])("can be dismissed after %j", (before) => {
    const doc = apply(
      utils.createDocument(),
      ...before.map((status, i) => setGuidedLoop({ status, at: at(i) })),
      setGuidedLoop({ status: "DISMISSED", at: at(9) }),
    );
    expect(doc.operations.global.every((o) => !o.error)).toBe(true);
    expect(doc.state.global.guidedLoop).toEqual({
      status: "DISMISSED",
      at: at(9),
    });
  });

  it.each<[GuidedLoopStatus[], GuidedLoopStatus]>([
    [[], "NOT_STARTED"],
    [["CHANGED"], "POINTED"],
    [["CHANGED"], "CHANGED"],
    [["DONE"], "WENT_BACK"],
    [["DONE"], "DISMISSED"],
    [["DISMISSED"], "DISMISSED"],
    [["DISMISSED"], "DONE"],
  ])("after %j refuses %s (state unchanged)", (before, status) => {
    const doc = apply(
      utils.createDocument(),
      ...before.map((s, i) => setGuidedLoop({ status: s, at: at(i) })),
      setGuidedLoop({ status, at: at(9) }),
    );
    const last = before.at(-1) ?? "NOT_STARTED";
    expect(errorAt(doc, before.length)).toBe(
      `The guided loop can't go from ${last} to ${status}.`,
    );
    expect(doc.state.global.guidedLoop.status).toBe(last);
    expect(doc.state.global.guidedLoop.at).toBe(
      before.length ? at(before.length - 1) : null,
    );
  });
});

describe("ASK_QUESTION", () => {
  it("adds an open question to the change, trimmed", () => {
    const doc = apply(
      building(),
      askQuestion({
        ...QUESTION,
        text: "  Should a walk have a fixed length?  ",
        defaultAnswer: " No ",
      }),
    );
    expect(errorAt(doc, 3)).toBeNull();
    expect(change(doc).questions).toEqual([
      {
        id: "q1",
        text: "Should a walk have a fixed length?",
        options: ["Yes", "No"],
        defaultAnswer: "No",
        language: "en",
        askedAt: at(2),
        answer: null,
        answeredAt: null,
        answeredBy: null,
      },
    ]);
  });

  it("refuses an unknown change", () => {
    const doc = apply(building(), askQuestion({ ...QUESTION, changeId: "x" }));
    expect(errorAt(doc, 3)).toBe('No change "x" exists.');
  });

  it("refuses a duplicate question id (state unchanged)", () => {
    const doc = apply(asked(), askQuestion({ ...QUESTION, text: "Again?" }));
    expect(errorAt(doc, 4)).toBe('Change "c1" already has a question "q1".');
    expect(change(doc).questions.map((q) => q.text)).toEqual([QUESTION.text]);
  });

  it.each([
    ["empty text", { text: "   " }],
    ["text over 200 characters", { text: "a".repeat(201) }],
    ["more than 4 options", { options: ["a", "b", "c", "d", "e"] }],
    ["an empty default answer", { defaultAnswer: " " }],
    ["a language other than de or en", { language: "fr" }],
  ])("refuses a question with %s (state unchanged)", (_, patch) => {
    const doc = apply(building(), askQuestion({ ...QUESTION, ...patch }));
    expect(errorAt(doc, 3)).toMatch(/^A question has/);
    expect(change(doc).questions).toEqual([]);
  });

  it("accepts exactly 200 characters and 4 options in German", () => {
    const doc = apply(
      building(),
      askQuestion({
        ...QUESTION,
        text: "a".repeat(200),
        options: ["a", "b", "c", "d"],
        language: "de",
      }),
    );
    expect(errorAt(doc, 3)).toBeNull();
    expect(change(doc).questions).toHaveLength(1);
  });
});

describe("ANSWER_QUESTION", () => {
  it("records the room's answer", () => {
    const doc = apply(
      asked(),
      answerQuestion({
        changeId: "c1",
        id: "q1",
        answer: "Yes",
        answeredBy: "ROOM",
        answeredAt: at(3),
      }),
    );
    expect(errorAt(doc, 4)).toBeNull();
    expect(change(doc).questions[0]).toMatchObject({
      answer: "Yes",
      answeredBy: "ROOM",
      answeredAt: at(3),
    });
  });

  it.each([
    [
      "an unknown question",
      "c1",
      "q9",
      'No question "q9" exists on change "c1".',
    ],
    [
      "an unknown change",
      "c9",
      "q1",
      'No question "q1" exists on change "c9".',
    ],
  ])("refuses %s", (_, changeId, id, message) => {
    const doc = apply(
      asked(),
      answerQuestion({
        changeId,
        id,
        answer: "Yes",
        answeredBy: "ROOM",
        answeredAt: at(3),
      }),
    );
    expect(errorAt(doc, 4)).toBe(message);
  });

  it("refuses a second answer (state unchanged)", () => {
    const doc = apply(
      asked(),
      answerQuestion({
        changeId: "c1",
        id: "q1",
        answer: "No",
        answeredBy: "DEFAULT",
        answeredAt: at(3),
      }),
      answerQuestion({
        changeId: "c1",
        id: "q1",
        answer: "Yes",
        answeredBy: "ROOM",
        answeredAt: at(4),
      }),
    );
    expect(errorAt(doc, 5)).toBe('Question "q1" was already answered.');
    expect(change(doc).questions[0]).toMatchObject({
      answer: "No",
      answeredBy: "DEFAULT",
      answeredAt: at(3),
    });
  });
});

describe("SET_CHANGE_COST", () => {
  it("sets the start, then the end, keeping the other side", () => {
    const doc = apply(
      building(),
      setChangeCost({ changeId: "c1", startUsd: 0 }),
      setChangeCost({ changeId: "c1", endUsd: 1.25, startUsd: null }),
    );
    expect(errorAt(doc, 3)).toBeNull();
    expect(errorAt(doc, 4)).toBeNull();
    expect(change(doc).cost).toEqual({ startUsd: 0, endUsd: 1.25 });
  });

  it("can set both sides at once and starts from null", () => {
    let doc = building();
    expect(change(doc).cost).toBeNull();
    doc = apply(doc, setChangeCost({ changeId: "c1", startUsd: 2, endUsd: 3 }));
    expect(change(doc).cost).toEqual({ startUsd: 2, endUsd: 3 });
  });

  it("refuses an unknown change", () => {
    const doc = apply(
      building(),
      setChangeCost({ changeId: "x", startUsd: 1 }),
    );
    expect(errorAt(doc, 3)).toBe('No change "x" exists.');
  });

  it.each([
    [{ startUsd: -0.01 }],
    [{ endUsd: -1 }],
    [{ startUsd: 1, endUsd: -1 }],
  ])("refuses a negative cost %j (state unchanged)", (patch) => {
    const doc = apply(building(), setChangeCost({ changeId: "c1", ...patch }));
    expect(errorAt(doc, 3)).toBe("A cost is 0 or more.");
    expect(change(doc).cost).toBeNull();
  });
});

describe("START_ROW_IMPORT / FINISH_ROW_IMPORT", () => {
  it("starts a confirmed import", () => {
    const doc = rowImport();
    expect(errorAt(doc, 0)).toBeNull();
    expect(doc.state.global.rowImports).toEqual([
      {
        id: "ri1",
        materialId: "mat-2",
        sheet: "Dogs",
        documentType: "acme/dog",
        rows: 12,
        imported: 0,
        status: "CONFIRMED",
        at: at(3),
        failure: null,
      },
    ]);
  });

  it("finishes as done", () => {
    const doc = apply(
      rowImport(),
      finishRowImport({ id: "ri1", imported: 12, status: "DONE", at: at(4) }),
    );
    expect(errorAt(doc, 1)).toBeNull();
    expect(doc.state.global.rowImports[0]).toMatchObject({
      imported: 12,
      status: "DONE",
      at: at(4),
      failure: null,
    });
  });

  it("finishes as failed with a reason", () => {
    const doc = apply(
      rowImport(),
      finishRowImport({
        id: "ri1",
        imported: 5,
        status: "FAILED",
        failure: "Row 6 has no name",
        at: at(4),
      }),
    );
    expect(doc.state.global.rowImports[0]).toMatchObject({
      imported: 5,
      status: "FAILED",
      failure: "Row 6 has no name",
    });
  });

  it("refuses a duplicate import id (state unchanged)", () => {
    const doc = apply(
      rowImport(),
      startRowImport({
        id: "ri1",
        materialId: "mat-3",
        sheet: "Other",
        documentType: "acme/dog",
        rows: 1,
        at: at(5),
      }),
    );
    expect(errorAt(doc, 1)).toBe('A row import "ri1" already exists.');
    expect(doc.state.global.rowImports).toHaveLength(1);
  });

  it("refuses to finish an unknown import", () => {
    const doc = apply(
      rowImport(),
      finishRowImport({ id: "ri9", imported: 1, status: "DONE", at: at(4) }),
    );
    expect(errorAt(doc, 1)).toBe('No row import "ri9" exists.');
    expect(doc.state.global.rowImports[0].status).toBe("CONFIRMED");
  });
});
