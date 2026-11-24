import { describe, expect, it } from "@jest/globals";
import { applyJsonPath, encodeValue } from "../../src/commands/spec/projection.js";

const SAMPLE_DOC = {
  global: {
    name: "Workout Tracker",
    documentTypes: ["powerhouse/document-model", "powerhouse/editor"],
    schema: "type WorkoutTrackerState {\n  items: [String]\n}",
    specifications: [
      {
        version: 1,
        state: { global: { schema: "type OldState { x: Int }" } },
        modules: [
          {
            id: "m1",
            name: "core",
            operations: [
              { id: "o1", name: "INIT", schema: "input InitInput { x: Int }" },
            ],
          },
        ],
      },
      {
        version: 2,
        state: { global: { schema: "type NewState { y: String }" } },
        modules: [
          {
            id: "m2",
            name: "details",
            operations: [
              {
                id: "o2",
                name: "SET_MODEL_NAME",
                schema: "input SetModelNameInput { name: String! }",
              },
              {
                id: "o3",
                name: "SET_BUG_TITLE",
                schema: "input SetBugTitleInput { title: String! }",
              },
            ],
          },
          {
            id: "m3",
            name: "extra",
            operations: [
              {
                id: "o4",
                name: "ADD_ITEM",
                schema: "input AddItemInput { count: Int! }",
              },
            ],
          },
        ],
      },
    ],
  },
  nums: [1, 2, 3, 4, 5],
  empty: [],
  nested: {
    "k.with.dot": "dotted",
    "k with space": "spaced",
  },
  boolVal: false,
  nullVal: null,
  zeroVal: 0,
  emptyStr: "",
};

describe("applyJsonPath (piffero-plus)", () => {
  it("returns the whole object for root '$'", () => {
    expect(applyJsonPath(SAMPLE_DOC, "$")).toEqual(SAMPLE_DOC);
  });

  it("unwraps single matches and preserves falsy values", () => {
    expect(applyJsonPath(SAMPLE_DOC, "$.global.name")).toBe("Workout Tracker");
    expect(applyJsonPath(SAMPLE_DOC, "$.boolVal")).toBe(false);
    expect(applyJsonPath(SAMPLE_DOC, "$.nullVal")).toBeNull();
    expect(applyJsonPath(SAMPLE_DOC, "$.zeroVal")).toBe(0);
    expect(applyJsonPath(SAMPLE_DOC, "$.emptyStr")).toBe("");
  });

  it("returns undefined when nothing matches", () => {
    expect(applyJsonPath(SAMPLE_DOC, "$.nonexistent")).toBeUndefined();
    expect(applyJsonPath(SAMPLE_DOC, "$.empty[*]")).toBeUndefined();
  });

  it("returns an array when multiple nodes match", () => {
    expect(
      applyJsonPath(
        SAMPLE_DOC,
        "$.global.specifications[(@.length-1)].modules[*].name",
      ),
    ).toEqual(["details", "extra"]);
  });

  it("supports both [(@.length-1)] and RFC 9535 [-1] indexing", () => {
    expect(
      applyJsonPath(SAMPLE_DOC, "$.global.specifications[(@.length-1)].version"),
    ).toBe(2);
    expect(
      applyJsonPath(SAMPLE_DOC, "$.global.specifications[-1].version"),
    ).toBe(2);
    expect(
      applyJsonPath(
        SAMPLE_DOC,
        "$.global.specifications[(@.length-1)].state.global.schema",
      ),
    ).toBe("type NewState { y: String }");
  });

  it("supports all vetra-cli spec-get and spec-schema filter expressions", () => {
    expect(
      applyJsonPath(
        SAMPLE_DOC,
        "$.global.specifications[(@.length-1)].modules[*].operations[*].name",
      ),
    ).toEqual(["SET_MODEL_NAME", "SET_BUG_TITLE", "ADD_ITEM"]);

    expect(
      applyJsonPath(
        SAMPLE_DOC,
        '$.global.specifications[(@.length-1)].modules[?(@.name=="details")].operations[*].name',
      ),
    ).toEqual(["SET_MODEL_NAME", "SET_BUG_TITLE"]);

    expect(
      applyJsonPath(
        SAMPLE_DOC,
        "$.global.specifications[(@.length-1)].modules[?(@.name=='details')].operations[?(@.name=='SET_BUG_TITLE')]",
      ),
    ).toEqual({
      id: "o3",
      name: "SET_BUG_TITLE",
      schema: "input SetBugTitleInput { title: String! }",
    });

    // Multi-action OR filter used by `spec-schema --action A,B`
    expect(
      applyJsonPath(
        SAMPLE_DOC,
        "$.global.specifications[(@.length-1)].modules[*].operations[?(@.name=='SET_MODEL_NAME' || @.name=='ADD_ITEM')].schema",
      ),
    ).toEqual([
      "input SetModelNameInput { name: String! }",
      "input AddItemInput { count: Int! }",
    ]);

    // RFC 9535 filter without outer parentheses
    expect(
      applyJsonPath(
        SAMPLE_DOC,
        '$.global.specifications[-1].modules[?@.name=="details"].operations[*].name',
      ),
    ).toEqual(["SET_MODEL_NAME", "SET_BUG_TITLE"]);
  });

  it("supports slices, unions, recursive descent, and quoted bracket keys", () => {
    expect(applyJsonPath(SAMPLE_DOC, "$.nums[1:3]")).toEqual([2, 3]);
    expect(applyJsonPath(SAMPLE_DOC, "$.nums[::2]")).toEqual([1, 3, 5]);
    expect(applyJsonPath(SAMPLE_DOC, "$.nums[-2:]")).toEqual([4, 5]);
    expect(applyJsonPath(SAMPLE_DOC, "$.nums[0,2,4]")).toEqual([1, 3, 5]);
    expect(applyJsonPath(SAMPLE_DOC, "$..operations[*].name")).toEqual([
      "INIT",
      "SET_MODEL_NAME",
      "SET_BUG_TITLE",
      "ADD_ITEM",
    ]);
    expect(applyJsonPath(SAMPLE_DOC, "$.nested['k.with.dot']")).toBe("dotted");
    expect(applyJsonPath(SAMPLE_DOC, '$.nested["k with space"]')).toBe("spaced");
  });

  it("handles primitive, null, and undefined root values safely", () => {
    expect(applyJsonPath("hello", "$")).toBe("hello");
    expect(applyJsonPath(42, "$")).toBe(42);
    expect(applyJsonPath(null, "$")).toBeNull();
    expect(applyJsonPath(undefined, "$")).toBeUndefined();
    expect(applyJsonPath("hello", "$.foo")).toBeUndefined();
    expect(applyJsonPath(null, "$.foo")).toBeUndefined();
  });

  it("throws a descriptive error on invalid JSONPath syntax", () => {
    expect(() => applyJsonPath(SAMPLE_DOC, "invalid[[[path")).toThrow(
      /Invalid JSONPath "invalid\[\[\[path"/,
    );
    expect(() => applyJsonPath(SAMPLE_DOC, "")).toThrow(/Invalid JSONPath ""/);
    expect(() => applyJsonPath(null, "invalid[[[path")).toThrow(
      /Invalid JSONPath "invalid\[\[\[path"/,
    );
  });
});

describe("encodeValue", () => {
  it("prints strings raw in both json and toon formats", () => {
    expect(encodeValue("a\nb", "json")).toBe("a\nb");
    expect(encodeValue("a\nb", "toon")).toBe("a\nb");
  });

  it("wraps scalars for toon encoding", () => {
    expect(encodeValue(42, "toon")).toContain("42");
  });
});
