import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { specCreate } from "../../src/commands/spec/create.js";
import {
  findByName,
  formatColumns,
  resolveActionsInput,
  renderProjected,
} from "../../src/commands/spec/_helpers.js";
import { makeCtx, makeWorkdir } from "./_fixtures.js";

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
  it("returns fallback summary when neither filter nor format set", () => {
    const out = renderProjected({ a: 1 }, undefined, undefined, "fallback");
    expect(out.text).toBe("fallback");
    expect(out.data?.value).toEqual({ a: 1 });
  });

  it("prints single-string projection results raw, no wrapping", () => {
    const out = renderProjected(
      { greeting: "line1\nline2" },
      "$.greeting",
      undefined,
      "fallback",
    );
    expect(out.text).toBe("line1\nline2");
    expect(out.data).toBeUndefined();
  });

  it("encodes object projections as JSON by default", () => {
    const out = renderProjected(
      { nums: [1, 2, 3] },
      "$.nums",
      undefined,
      "fallback",
    );
    expect(out.text).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("encodes object projections as toon when requested", () => {
    const out = renderProjected(
      { nums: [1, 2, 3] },
      "$.nums",
      "toon",
      "fallback",
    );
    expect(out.text).toContain("1");
    expect(out.text).toContain("2");
    expect(out.text).toContain("3");
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
    await expect(findByName(workdir, "Nope")).rejects.toThrow(/No spec found/);
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
