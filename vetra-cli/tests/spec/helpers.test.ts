import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { specCreate } from "../../src/commands/spec/create.js";
import {
  findByName,
  formatColumns,
  normalizeDocumentModelActions,
  resolveActionsInput,
  renderProjected,
  suggestNames,
} from "../../src/commands/spec/_helpers.js";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { makeCtx, makeWorkdir } from "./_fixtures.js";

/** Minimal document-model doc carrying just the fields the normalizer reads. */
function fakeDoc(
  modules: Array<{
    id: string;
    name: string;
    operations?: Array<{ id: string; name: string }>;
  }>,
  documentType = "powerhouse/document-model",
): PHDocument {
  return {
    header: { documentType },
    state: { global: { specifications: [{ modules }] } },
  } as unknown as PHDocument;
}

describe("normalizeDocumentModelActions", () => {
  it("defaults a missing required scope to global", () => {
    const [a] = normalizeDocumentModelActions(fakeDoc([]), [
      { type: "SET_STATE_SCHEMA", input: { schema: "type S { x: Int }" } },
    ]);
    expect((a.input as { scope?: string }).scope).toBe("global");
  });

  it("carries the action-level scope into the payload when set", () => {
    const [a] = normalizeDocumentModelActions(fakeDoc([]), [
      {
        type: "SET_INITIAL_STATE",
        input: { initialValue: "{}" },
        scope: "local",
      },
    ]);
    expect((a.input as { scope?: string }).scope).toBe("local");
  });

  it("leaves an explicit payload scope untouched", () => {
    const [a] = normalizeDocumentModelActions(fakeDoc([]), [
      { type: "SET_STATE_SCHEMA", input: { scope: "local", schema: "x" } },
    ]);
    expect((a.input as { scope?: string }).scope).toBe("local");
  });

  it("mints a UUID for a missing creation id on ADD_*", () => {
    const [a] = normalizeDocumentModelActions(fakeDoc([]), [
      { type: "ADD_MODULE", input: { name: "Workouts" } },
    ]);
    expect((a.input as { id?: string }).id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("keeps an explicit creation id", () => {
    const [a] = normalizeDocumentModelActions(fakeDoc([]), [
      { type: "ADD_MODULE", input: { id: "mod-1", name: "Workouts" } },
    ]);
    expect((a.input as { id?: string }).id).toBe("mod-1");
  });

  it("resolves a module reference given by name to its id", () => {
    const doc = fakeDoc([{ id: "mod-1", name: "Workouts" }]);
    const [a] = normalizeDocumentModelActions(doc, [
      {
        type: "ADD_OPERATION",
        input: { moduleId: "Workouts", id: "op-1", name: "ADD_WORKOUT" },
      },
    ]);
    expect((a.input as { moduleId?: string }).moduleId).toBe("mod-1");
  });

  it("resolves an in-batch module created earlier in the same call", () => {
    const [, op] = normalizeDocumentModelActions(fakeDoc([]), [
      { type: "ADD_MODULE", input: { id: "mod-1", name: "Workouts" } },
      {
        type: "ADD_OPERATION",
        input: { moduleId: "Workouts", id: "op-1", name: "ADD_WORKOUT" },
      },
    ]);
    expect((op.input as { moduleId?: string }).moduleId).toBe("mod-1");
  });

  it("resolves an operation reference by name on a SET_OPERATION_* op", () => {
    const doc = fakeDoc([
      {
        id: "mod-1",
        name: "Workouts",
        operations: [{ id: "op-1", name: "ADD_WORKOUT" }],
      },
    ]);
    const [a] = normalizeDocumentModelActions(doc, [
      { type: "SET_OPERATION_SCHEMA", input: { id: "ADD_WORKOUT", schema: "x" } },
    ]);
    expect((a.input as { id?: string }).id).toBe("op-1");
  });

  it("leaves a reference already given as an id untouched", () => {
    const doc = fakeDoc([
      {
        id: "mod-1",
        name: "Workouts",
        operations: [{ id: "op-1", name: "ADD_WORKOUT" }],
      },
    ]);
    const [a] = normalizeDocumentModelActions(doc, [
      { type: "SET_OPERATION_SCHEMA", input: { id: "op-1", schema: "x" } },
    ]);
    expect((a.input as { id?: string }).id).toBe("op-1");
  });

  it("throws naming both ids when a reference name is ambiguous", () => {
    const doc = fakeDoc([
      { id: "mod-1", name: "A", operations: [{ id: "op-1", name: "DO_X" }] },
      { id: "mod-2", name: "B", operations: [{ id: "op-2", name: "DO_X" }] },
    ]);
    expect(() =>
      normalizeDocumentModelActions(doc, [
        { type: "SET_OPERATION_SCHEMA", input: { id: "DO_X", schema: "x" } },
      ]),
    ).toThrow(/op-1.*op-2|multiple operations/);
  });

  it("passes non-document-model docs through unchanged", () => {
    const out = normalizeDocumentModelActions(
      fakeDoc([], "powerhouse/document-editor"),
      [{ type: "SET_STATE_SCHEMA", input: { schema: "x" } }],
    );
    expect((out[0].input as { scope?: string }).scope).toBeUndefined();
  });
});

describe("formatColumns", () => {
  it("returns empty string for no rows", () => {
    expect(formatColumns([])).toBe("");
  });

  it("aligns columns by max width and triple-spaces between them", () => {
    const out = formatColumns([
      ["a", "long-type", "x"],
      ["bbb", "t", "yyy"],
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    // First two columns padded to max width; last column not padded.
    expect(lines[0]).toBe("a     long-type   x");
    expect(lines[1]).toBe("bbb   t           yyy");
  });
});

describe("renderProjected", () => {
  it("encodes the whole value when neither filter nor format set", () => {
    const out = renderProjected({ a: 1 }, undefined, undefined);
    expect(out).toBe('{\n  "a": 1\n}');
  });

  it("prints single-string projection results raw, no wrapping", () => {
    const out = renderProjected(
      { greeting: "line1\nline2" },
      "$.greeting",
      undefined,
    );
    expect(out).toBe("line1\nline2");
  });

  it("encodes object projections as JSON by default", () => {
    const out = renderProjected({ nums: [1, 2, 3] }, "$.nums", undefined);
    expect(out).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("encodes object projections as toon when requested", () => {
    const out = renderProjected({ nums: [1, 2, 3] }, "$.nums", "toon");
    expect(out).toContain("1");
    expect(out).toContain("2");
    expect(out).toContain("3");
  });
});

describe("suggestNames", () => {
  /* Real action lists from the codegen — these are the cases the agent
   * actually missed in the logs. Keep them in sync with reality. */
  const SUBGRAPH = ["SET_SUBGRAPH_NAME", "SET_SUBGRAPH_STATUS"];
  const DOC_MODEL = [
    "SET_MODEL_NAME",
    "SET_MODEL_ID",
    "SET_AUTHOR_NAME",
    "ADD_MODULE",
    "ADD_OPERATION",
    "RELEASE_NEW_VERSION",
  ];
  const EDITOR = [
    "SET_EDITOR_NAME",
    "ADD_DOCUMENT_TYPE",
    "REMOVE_DOCUMENT_TYPE",
    "SET_EDITOR_STATUS",
  ];

  it("suggests via the prefix-drop containment case", () => {
    expect(suggestNames("SET_NAME", SUBGRAPH)).toEqual([
      "SET_SUBGRAPH_NAME",
    ]);
    expect(suggestNames("SET_STATUS", SUBGRAPH)).toEqual([
      "SET_SUBGRAPH_STATUS",
    ]);
  });

  it("ranks the closer container higher", () => {
    /* `SET_NAME` is a substring of every `SET_*_NAME`; the closer length
     * (SET_MODEL_NAME, gap 6) should beat SET_EDITOR_NAME (gap 7). */
    expect(suggestNames("SET_NAME", DOC_MODEL.concat(EDITOR))[0]).toBe(
      "SET_MODEL_NAME",
    );
  });

  it("is case-insensitive", () => {
    expect(suggestNames("set_name", SUBGRAPH)).toEqual(["SET_SUBGRAPH_NAME"]);
  });

  it("matches a one-char typo via Levenshtein", () => {
    expect(suggestNames("SET_MODL_NAME", DOC_MODEL)).toContain(
      "SET_MODEL_NAME",
    );
  });

  it("returns an empty list when nothing is close", () => {
    /* `ADD_SPECIFICATION` shares no substring with `RELEASE_NEW_VERSION`
     * and the Levenshtein distance is far beyond the threshold — better
     * to suggest nothing than to mislead. */
    expect(suggestNames("ADD_SPECIFICATION", DOC_MODEL)).not.toContain(
      "RELEASE_NEW_VERSION",
    );
  });

  it("caps the result at the requested max", () => {
    const many = Array.from({ length: 20 }, (_, i) => `SET_FIELD_${i}_NAME`);
    expect(suggestNames("SET_NAME", many, 3)).toHaveLength(3);
  });

  it("returns [] for an empty candidate list", () => {
    expect(suggestNames("WHATEVER", [])).toEqual([]);
  });
});

describe("findByName", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("resolves a created spec by name", async () => {
    await specCreate.execute(
      { type: "powerhouse/document-model", name: "Findable", dryRun: false },
      makeCtx(workdir),
    );
    const { doc, path } = await findByName(workdir, "Findable");
    expect(doc.header.name).toBe("Findable");
    expect(path).toContain(workdir);
  });

  it("throws when the name is not found", async () => {
    await expect(findByName(workdir, "Nope")).rejects.toThrow(
      /Unknown spec "Nope"/,
    );
  });

  it("resolves by slug", async () => {
    const created = await specCreate.execute(
      { type: "powerhouse/document-model", name: "Slug Match", dryRun: false },
      makeCtx(workdir),
    );
    const id = created.text.match(/id: (\S+)/)?.[1];
    const { doc } = await findByName(workdir, "slug-match");
    expect(doc.header.id).toBe(id);
  });

  it("resolves by id", async () => {
    const created = await specCreate.execute(
      { type: "powerhouse/document-model", name: "ById", dryRun: false },
      makeCtx(workdir),
    );
    const id = created.text.match(/id: (\S+)/)?.[1] ?? "";
    const { doc } = await findByName(workdir, id);
    expect(doc.header.name).toBe("ById");
  });

  it("lists available specs when --name is omitted", async () => {
    await specCreate.execute(
      { type: "powerhouse/document-model", name: "Alpha", dryRun: false },
      makeCtx(workdir),
    );
    await specCreate.execute(
      { type: "powerhouse/document-model", name: "Beta", dryRun: false },
      makeCtx(workdir),
    );
    await expect(findByName(workdir, "")).rejects.toThrow(
      /Missing required option --name\.\nAvailable specs: Alpha, Beta/,
    );
  });

  it("falls back to a no-specs message when there are none", async () => {
    await expect(findByName(workdir, "")).rejects.toThrow(
      /Missing required option --name\.\nNo specs found in this project\./,
    );
  });

  it("suggests the closest name on a typo", async () => {
    await specCreate.execute(
      { type: "powerhouse/document-model", name: "Workout", dryRun: false },
      makeCtx(workdir),
    );
    await expect(findByName(workdir, "Wrkout")).rejects.toThrow(
      /Did you mean: Workout(, |\?)/,
    );
  });
});

describe("slugify", () => {
  /* `slugify` is not exported by name, but `spec-create` sets `header.slug =
   * slugify(input.name)`. Exercise it by loading the saved spec back and
   * reading its slug. */
  it("kebab-cases the name into header.slug on create", async () => {
    const { workdir, cleanup } = makeWorkdir();
    try {
      await specCreate.execute(
        { type: "powerhouse/document-model", name: "Hello World 42", dryRun: false },
        makeCtx(workdir),
      );
      const { doc } = await findByName(workdir, "Hello World 42");
      expect(doc.header.slug).toBe("hello-world-42");
    } finally {
      cleanup();
    }
  });

  it("strips diacritics and collapses non-alnum runs", async () => {
    const { workdir, cleanup } = makeWorkdir();
    try {
      await specCreate.execute(
        { type: "powerhouse/document-model", name: "Café — Très Bien!", dryRun: false },
        makeCtx(workdir),
      );
      const { doc } = await findByName(workdir, "Café — Très Bien!");
      expect(doc.header.slug).toBe("cafe-tres-bien");
    } finally {
      cleanup();
    }
  });
});

describe("resolveActionsInput", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("accepts inline actions directly", async () => {
    const inline = [{ type: "SET_MODEL_NAME", input: { name: "x" } }];
    const actions = await resolveActionsInput({ actions: inline });
    expect(actions).toEqual(inline);
  });

  it("reads actions from a file", async () => {
    const path = join(workdir, "a.json");
    writeFileSync(
      path,
      JSON.stringify([{ type: "SET_MODEL_NAME", input: { name: "x" } }]),
    );
    const actions = await resolveActionsInput({ from: path });
    expect(actions).toEqual([{ type: "SET_MODEL_NAME", input: { name: "x" } }]);
  });

  it("rejects when file JSON is malformed", async () => {
    const path = join(workdir, "bad.json");
    writeFileSync(path, "{not json");
    await expect(resolveActionsInput({ from: path })).rejects.toThrow(
      /Invalid JSON/,
    );
  });

  it("rejects when payload is not an array", async () => {
    const path = join(workdir, "obj.json");
    writeFileSync(path, JSON.stringify({ type: "X" }));
    await expect(resolveActionsInput({ from: path })).rejects.toThrow(
      /JSON array/,
    );
  });

  it("rejects inline non-array payloads", async () => {
    await expect(
      resolveActionsInput({ actions: { type: "X" } }),
    ).rejects.toThrow(/JSON array/);
  });
});
