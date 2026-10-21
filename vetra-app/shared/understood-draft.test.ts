import { describe, expect, it } from "vitest";
import {
  DRAFT_LIMITS,
  addField,
  addRole,
  addStep,
  addThing,
  draftToBrief,
  mergeDrafts,
  mergeThings,
  moveStep,
  normalizeName,
  parseDraft,
  removeField,
  removeRole,
  removeStep,
  removeThing,
  renameField,
  renameRole,
  renameStep,
  renameThing,
  setFieldType,
  setStepRole,
  splitThing,
  type UnderstoodDraft,
} from "./understood-draft.js";

const counter = () => {
  let n = 0;
  return () => `gen-${++n}`;
};

function draft(over: Partial<UnderstoodDraft> = {}): UnderstoodDraft {
  return {
    version: 1,
    language: "en",
    summary: "",
    things: [],
    roles: [],
    steps: [],
    links: [],
    questions: [],
    materials: [],
    ...over,
  };
}

describe("parseDraft", () => {
  it("fills ids and maps unknown types to text", () => {
    const raw =
      "Here you go:\n```json\n" +
      JSON.stringify({
        things: [
          {
            name: "Defect",
            fields: [
              { name: "Severity", type: "weird" },
              { name: "Due", type: "date" },
            ],
          },
        ],
        steps: [{ name: "Check" }],
      }) +
      "\n```";
    const d = parseDraft(raw, counter());
    expect(d?.things[0].id).toMatch(/^gen-/);
    expect(d?.things[0].fields.map((f) => f.type)).toEqual(["text", "date"]);
    expect(d?.things[0].fields[0].id).toMatch(/^gen-/);
    expect(d?.things[0].fields[0].id).not.toBe(d?.things[0].fields[1].id);
    expect(d?.steps[0].id).toBeTruthy();
    expect(d?.language).toBe("en");
  });

  it("returns null without things or without JSON", () => {
    expect(parseDraft("nothing", counter())).toBeNull();
    expect(parseDraft('{"things": []}', counter())).toBeNull();
  });

  it("limits are clamped", () => {
    const things = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`,
      name: `Thing ${i}`,
      fields: Array.from({ length: 40 }, (_, j) => ({
        name: `F${j}`,
        type: "choice",
        options: Array.from({ length: 30 }, (_, k) => `o${k}`),
      })),
    }));
    const d = parseDraft(
      JSON.stringify({
        things,
        roles: Array.from({ length: 20 }, (_, i) => ({ name: `R${i}` })),
        steps: Array.from({ length: 50 }, (_, i) => ({
          name: `S${i}`,
          thingId: "t0",
        })),
        questions: Array.from({ length: 12 }, (_, i) => `Q${i}`),
        summary: "x".repeat(2000),
      }),
      counter(),
    );
    expect(d?.things).toHaveLength(DRAFT_LIMITS.things);
    expect(d?.things[0].fields).toHaveLength(DRAFT_LIMITS.fieldsPerThing);
    expect(d?.things[0].fields[0].options).toHaveLength(DRAFT_LIMITS.options);
    expect(d?.roles).toHaveLength(DRAFT_LIMITS.roles);
    expect(d?.steps).toHaveLength(DRAFT_LIMITS.steps);
    expect(d?.questions).toHaveLength(DRAFT_LIMITS.questions);
    expect(d?.summary).toHaveLength(DRAFT_LIMITS.summary);
  });

  it("drops dangling references and keeps sources", () => {
    const d = parseDraft(
      JSON.stringify({
        language: "de",
        things: [
          {
            id: "a",
            name: "A",
            fields: [
              {
                name: "x",
                source: { materialId: "m1", sheet: "S", column: "C" },
              },
            ],
          },
        ],
        steps: [{ name: "s", roleId: "nope", thingId: "a" }],
        links: [{ from: "a", to: "zzz", label: "l" }],
      }),
      counter(),
    );
    expect(d?.language).toBe("de");
    expect(d?.steps[0]).toMatchObject({ roleId: null, thingId: "a" });
    expect(d?.links).toEqual([]);
    expect(d?.things[0].fields[0].source).toEqual({
      materialId: "m1",
      sheet: "S",
      column: "C",
    });
  });
});

describe("normalizeName", () => {
  it("folds German", () => {
    expect(normalizeName("Mängel")).toBe(normalizeName("Mangel"));
    expect(normalizeName("Prüfungen")).toBe(normalizeName("Prüfung"));
    expect(normalizeName("Straße")).toBe(normalizeName("Strassen"));
  });
});

describe("mergeDrafts", () => {
  const src = (sheet: string, column: string) => ({
    materialId: "m",
    sheet,
    column,
  });
  const field = (
    id: string,
    name: string,
    type: "text" | "number",
    s: ReturnType<typeof src> | null,
  ) => ({
    id,
    name,
    type,
    options: [],
    source: s,
  });

  it("merge joins Mangel and Mängel", () => {
    const a = draft({
      things: [
        {
          id: "a1",
          name: "Mangel",
          fields: [field("f1", "Titel", "text", null)],
        },
      ],
      roles: [{ id: "r1", name: "Bauleiter" }],
      steps: [{ id: "s1", name: "Erfassen", roleId: "r1", thingId: "a1" }],
    });
    const b = draft({
      things: [
        {
          id: "b1",
          name: "Mängel",
          fields: [
            field("f2", "titel", "number", null),
            field("f3", "Frist", "text", null),
          ],
        },
        { id: "b2", name: "Projekt", fields: [] },
      ],
      roles: [{ id: "r2", name: "bauleiter" }],
      steps: [
        { id: "s2", name: "Erfassen", roleId: "r2", thingId: "b1" },
        { id: "s3", name: "Prüfen", roleId: "r2", thingId: "b1" },
      ],
      links: [{ from: "b2", to: "b1", label: "hat" }],
    });
    const m = mergeDrafts([a, b]);
    expect(m.things.map((t) => t.name)).toEqual(["Mangel", "Projekt"]);
    expect(m.things[0].fields.map((f) => [f.name, f.type])).toEqual([
      ["Titel", "text"],
      ["Frist", "text"],
    ]);
    expect(m.roles).toHaveLength(1);
    expect(m.steps.map((s) => s.name)).toEqual(["Erfassen", "Prüfen"]);
    expect(m.steps[1]).toMatchObject({ roleId: "r1", thingId: "a1" });
    expect(m.links).toEqual([{ from: "b2", to: "a1", label: "hat" }]);
  });

  it("merge keeps both sources of a merged field", () => {
    const a = draft({
      things: [
        {
          id: "a",
          name: "Defect",
          fields: [field("f1", "Title", "text", src("S1", "A"))],
        },
      ],
    });
    const b = draft({
      things: [
        {
          id: "b",
          name: "Defects",
          fields: [
            field("f2", "Title", "text", src("S2", "B")),
            field("f3", "Title", "text", src("S1", "A")),
          ],
        },
      ],
    });
    const f = mergeDrafts([a, b]).things[0].fields;
    expect(f).toHaveLength(1);
    expect(f[0].source).toEqual(src("S1", "A"));
    expect(f[0].alsoFrom).toEqual([src("S2", "B")]);
  });

  it("handles an empty list and dedupes questions and materials", () => {
    expect(mergeDrafts([]).things).toEqual([]);
    const x = draft({
      questions: ["q"],
      materials: [{ id: "m", name: "n", kind: "SHEET" }],
      summary: "s",
    });
    const m = mergeDrafts([x, x]);
    expect(m.questions).toEqual(["q"]);
    expect(m.materials).toHaveLength(1);
    expect(m.summary).toBe("s");
  });
});

describe("edits", () => {
  const base = () =>
    draft({
      things: [
        {
          id: "t1",
          name: "Defect",
          fields: [
            {
              id: "f1",
              name: "Title",
              type: "text",
              options: [],
              source: null,
            },
            {
              id: "f2",
              name: "Photo",
              type: "photo",
              options: [],
              source: null,
            },
          ],
        },
        {
          id: "t2",
          name: "Site",
          fields: [
            {
              id: "f3",
              name: "Title",
              type: "text",
              options: [],
              source: { materialId: "m", sheet: null, column: "A" },
            },
          ],
        },
      ],
      roles: [{ id: "r1", name: "Lead" }],
      steps: [
        { id: "s1", name: "One", roleId: "r1", thingId: "t1" },
        { id: "s2", name: "Two", roleId: null, thingId: "t2" },
        { id: "s3", name: "Three", roleId: "r1", thingId: null },
      ],
      links: [{ from: "t1", to: "t2", label: "at" }],
    });

  it("removing a thing drops its links and step references", () => {
    const d = removeThing(base(), "t1");
    expect(d.things.map((t) => t.id)).toEqual(["t2"]);
    expect(d.links).toEqual([]);
    expect(d.steps[0].thingId).toBeNull();
    expect(d.steps[1].thingId).toBe("t2");
  });

  it("split moves the chosen fields to the new thing", () => {
    const d = splitThing(base(), "t1", ["f2"], "t9", "Pictures");
    expect(d.things.map((t) => t.id)).toEqual(["t1", "t9", "t2"]);
    expect(d.things[0].fields.map((f) => f.id)).toEqual(["f1"]);
    expect(d.things[1]).toMatchObject({ name: "Pictures" });
    expect(d.things[1].fields.map((f) => f.id)).toEqual(["f2"]);
    expect(splitThing(base(), "nope", [], "x", "x")).toEqual(base());
  });

  it("moveStep reorders", () => {
    expect(moveStep(base(), "s3", 0).steps.map((s) => s.id)).toEqual([
      "s3",
      "s1",
      "s2",
    ]);
    expect(moveStep(base(), "s1", 99).steps.map((s) => s.id)).toEqual([
      "s2",
      "s3",
      "s1",
    ]);
    expect(moveStep(base(), "zz", 0)).toEqual(base());
  });

  it("removing a role clears it on steps", () => {
    const d = removeRole(base(), "r1");
    expect(d.roles).toEqual([]);
    expect(d.steps.map((s) => s.roleId)).toEqual([null, null, null]);
  });

  it("mergeThings folds fields, links and steps", () => {
    const d = mergeThings(base(), "t1", "t2");
    expect(d.things).toHaveLength(1);
    expect(d.things[0].fields.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(d.things[0].fields[0].source).toEqual({
      materialId: "m",
      sheet: null,
      column: "A",
    });
    expect(d.links).toEqual([]);
    expect(d.steps[1].thingId).toBe("t1");
    expect(mergeThings(base(), "t1", "t1")).toEqual(base());
    expect(mergeThings(base(), "t1", "nope")).toEqual(base());
  });

  it("simple edits", () => {
    let d = renameThing(base(), "t1", "Issue");
    d = addThing(d, "t3", "New");
    d = renameField(d, "t1", "f1", "Name");
    d = setFieldType(d, "t1", "f1", "choice");
    d = addField(d, "t3", {
      id: "f9",
      name: "X",
      type: "text",
      options: [],
      source: null,
    });
    d = removeField(d, "t1", "f2");
    d = renameRole(addRole(d, "r2", "Crew"), "r1", "Boss");
    d = addStep(renameStep(d, "s1", "Uno"), {
      id: "s4",
      name: "Four",
      roleId: null,
      thingId: null,
    });
    d = setStepRole(removeStep(d, "s2"), "s4", "r2");
    expect(d.things.map((t) => t.name)).toEqual(["Issue", "Site", "New"]);
    expect(d.things[0].fields).toEqual([
      expect.objectContaining({ name: "Name", type: "choice" }),
    ]);
    expect(d.things[2].fields[0].id).toBe("f9");
    expect(d.roles.map((r) => r.name)).toEqual(["Boss", "Crew"]);
    expect(d.steps.map((s) => s.name)).toEqual(["Uno", "Three", "Four"]);
    expect(d.steps[2].roleId).toBe("r2");
  });
});

describe("draftToBrief", () => {
  it("has the exact headings and the sheet source", () => {
    const d = draft({
      summary: "Site inspections.",
      materials: [{ id: "m", name: "list.xlsx", kind: "SHEET" }],
      things: [
        {
          id: "t1",
          name: "Mängel",
          fields: [
            {
              id: "f1",
              name: "Status",
              type: "choice",
              options: ["open", "done"],
              source: { materialId: "m", sheet: "Liste", column: "Status" },
            },
            {
              id: "f2",
              name: "Titel",
              type: "text",
              options: [],
              source: null,
            },
          ],
        },
        { id: "t2", name: "Baustelle", fields: [] },
      ],
      roles: [{ id: "r1", name: "Bauleiter" }],
      steps: [{ id: "s1", name: "Erfassen", roleId: "r1", thingId: "t1" }],
      links: [{ from: "t1", to: "t2", label: "auf" }],
      questions: ["Who signs off?"],
    });
    const b = draftToBrief(d, "de");
    expect(b.split("\n")[0]).toBe(
      "[What we understood — confirmed by the customer]",
    );
    expect(b).toContain("Things to keep track of:");
    expect(b).toContain(
      "- Mängel: Status (choice: open|done) [from Liste › Status]",
    );
    expect(b).toContain("- Mängel: Titel (text)");
    expect(b).toContain("Who: Bauleiter");
    expect(b).toContain("Steps:\n1. Erfassen (Bauleiter, Mängel)");
    expect(b).toContain("Links:\nMängel → Baustelle (auf)");
    expect(b).toContain("Open questions: Who signs off?");
    expect(b).toContain("- Baustelle");
  });
});
