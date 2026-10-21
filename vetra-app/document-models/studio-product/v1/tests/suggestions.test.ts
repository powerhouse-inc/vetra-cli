import type { StudioProductDocument } from "document-models/studio-product/v1";
import {
  dismissSuggestion,
  initProduct,
  isStudioProductDocument,
  setSuggestions,
  useSuggestion,
  utils,
} from "document-models/studio-product/v1";
import { describe, expect, it } from "vitest";
import { currentSuggestions } from "../src/utils.js";
import { apply, at, errorAt, lastError } from "./helpers.js";

function product(): StudioProductDocument {
  return apply(
    utils.createDocument(),
    initProduct({
      name: "Dog walks",
      idea: "plan dog walks",
      createdAt: at(0),
    }),
  );
}

const TWO = [
  { id: "s1", text: "Let walkers see the route" },
  { id: "s2", text: "Add a daily summary" },
];

describe("SuggestionsOperations", () => {
  it("suggest keeps 2–3 items: a set replaces the open ideas for its version", () => {
    let doc = apply(product(), setSuggestions({ afterVersion: 1, items: TWO }));
    expect(isStudioProductDocument(doc)).toBe(true);
    expect(doc.state.global.suggestions).toEqual([
      {
        id: "s1",
        text: "Let walkers see the route",
        afterVersion: 1,
        status: "OPEN",
      },
      {
        id: "s2",
        text: "Add a daily summary",
        afterVersion: 1,
        status: "OPEN",
      },
    ]);

    // A used idea stays; the open one for version 1 is replaced.
    doc = apply(
      doc,
      useSuggestion({ id: "s1" }),
      setSuggestions({
        afterVersion: 1,
        items: [
          { id: "s3", text: "  Allow allergen notes  " },
          { id: "s4", text: "Remind walkers by email" },
          { id: "s5", text: "Show a weekly chart" },
        ],
      }),
    );
    expect(doc.state.global.suggestions.map((s) => [s.id, s.status])).toEqual([
      ["s1", "USED"],
      ["s3", "OPEN"],
      ["s4", "OPEN"],
      ["s5", "OPEN"],
    ]);
    expect(doc.state.global.suggestions[1].text).toBe("Allow allergen notes");

    // Ideas for another version are kept alongside.
    doc = apply(
      doc,
      setSuggestions({
        afterVersion: 2,
        items: TWO.map((t) => ({ ...t, id: `${t.id}-v2` })),
      }),
    );
    expect(doc.state.global.suggestions).toHaveLength(6);
  });

  it("refuses a set that is too small, too large, too long, empty or reuses an id", () => {
    const base = apply(
      product(),
      setSuggestions({ afterVersion: 1, items: TWO }),
    );
    const before = base.state.global.suggestions;
    const doc = apply(
      base,
      setSuggestions({ afterVersion: 2, items: [TWO[0]] }),
      setSuggestions({
        afterVersion: 2,
        items: [1, 2, 3, 4].map((n) => ({ id: `x${n}`, text: `idea ${n}` })),
      }),
      setSuggestions({
        afterVersion: 2,
        items: [
          { id: "x1", text: "a".repeat(81) },
          { id: "x2", text: "ok" },
        ],
      }),
      setSuggestions({
        afterVersion: 2,
        items: [
          { id: "x1", text: "   " },
          { id: "x2", text: "ok" },
        ],
      }),
      setSuggestions({
        afterVersion: 2,
        items: [
          { id: "s1", text: "again" },
          { id: "x2", text: "ok" },
        ],
      }),
      setSuggestions({
        afterVersion: 2,
        items: [
          { id: "x1", text: "one" },
          { id: "x1", text: "two" },
        ],
      }),
      setSuggestions({ afterVersion: 0, items: TWO }),
    );
    const offset = base.operations.global.length;
    expect(errorAt(doc, offset)).toBe("Give 2 to 3 suggestions, not 1.");
    expect(errorAt(doc, offset + 1)).toBe("Give 2 to 3 suggestions, not 4.");
    expect(errorAt(doc, offset + 2)).toBe(
      "A suggestion is 1 to 80 characters long.",
    );
    expect(errorAt(doc, offset + 3)).toBe(
      "A suggestion is 1 to 80 characters long.",
    );
    expect(errorAt(doc, offset + 4)).toBe('A suggestion "s1" already exists.');
    expect(errorAt(doc, offset + 5)).toBe('A suggestion "x1" already exists.');
    expect(errorAt(doc, offset + 6)).toBe(
      "Suggestions follow version 1 or later, not 0.",
    );
    expect(doc.state.global.suggestions).toEqual(before);
  });

  it("using a suggestion marks it used; dismissing one marks it dismissed", () => {
    let doc = apply(
      product(),
      setSuggestions({ afterVersion: 1, items: TWO }),
      useSuggestion({ id: "s1" }),
      dismissSuggestion({ id: "s2" }),
    );
    expect(doc.state.global.suggestions.map((s) => s.status)).toEqual([
      "USED",
      "DISMISSED",
    ]);

    doc = apply(
      doc,
      useSuggestion({ id: "s2" }),
      dismissSuggestion({ id: "s1" }),
      useSuggestion({ id: "nope" }),
    );
    expect(lastError(doc)).toBe('No suggestion "nope" exists.');
    const n = doc.operations.global.length;
    expect(errorAt(doc, n - 3)).toBe('Suggestion "s2" is DISMISSED, not OPEN.');
    expect(errorAt(doc, n - 2)).toBe('Suggestion "s1" is USED, not OPEN.');
    expect(doc.state.global.suggestions.map((s) => s.status)).toEqual([
      "USED",
      "DISMISSED",
    ]);
  });

  it("a document from an earlier build without suggestions still takes them", () => {
    const doc = product();
    const legacy = {
      ...doc,
      state: {
        ...doc.state,
        global: { ...doc.state.global, suggestions: undefined },
      },
    } as unknown as StudioProductDocument;
    const out = apply(legacy, setSuggestions({ afterVersion: 1, items: TWO }));
    expect(out.state.global.suggestions).toHaveLength(2);
  });

  it("only the open ideas for the live version are offered", () => {
    const doc = apply(
      product(),
      setSuggestions({ afterVersion: 1, items: TWO }),
      setSuggestions({
        afterVersion: 2,
        items: TWO.map((t) => ({ ...t, id: `${t.id}-v2` })),
      }),
      dismissSuggestion({ id: "s2" }),
    );
    const s = doc.state.global;
    expect(currentSuggestions(s)).toEqual([]);
    expect(
      currentSuggestions({ ...s, liveVersion: 1 }).map((x) => x.id),
    ).toEqual(["s1"]);
    expect(
      currentSuggestions({ ...s, liveVersion: 2 }).map((x) => x.id),
    ).toEqual(["s1-v2", "s2-v2"]);
    expect(
      currentSuggestions({
        ...s,
        liveVersion: 1,
        suggestions: undefined,
      } as never),
    ).toEqual([]);
  });
});
