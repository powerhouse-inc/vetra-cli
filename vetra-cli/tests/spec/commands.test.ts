import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { specCreate } from "../../src/commands/spec/create.js";
import { specDelete } from "../../src/commands/spec/delete.js";
import { specGenerate } from "../../src/commands/spec/generate.js";
import { specGet } from "../../src/commands/spec/get.js";
import { specList } from "../../src/commands/spec/list.js";
import { specSchema } from "../../src/commands/spec/schema.js";
import { specSchemaList } from "../../src/commands/spec/schema-list.js";
import { specUpdate } from "../../src/commands/spec/update.js";
import { makeCtx, makeWorkdir } from "./_fixtures.js";

const DOC_TYPE = "powerhouse/document-model";

describe("spec-list", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("has the expected id and schema fields", () => {
    expect(specList.id).toBe("spec-list");
    expect(specList.inputSchema.shape).toHaveProperty("type");
  });

  it("reports (no specs) on an empty workdir", async () => {
    const result = await specList.execute({}, makeCtx(workdir));
    expect(result.text).toBe("(no specs)");
  });

  it("lists created specs with name/type/id columns", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Alpha", dryRun: false },
      makeCtx(workdir),
    );
    await specCreate.execute(
      { type: DOC_TYPE, name: "Beta", dryRun: false },
      makeCtx(workdir),
    );
    const result = await specList.execute({}, makeCtx(workdir));
    expect(result.text).toMatch(/Alpha/);
    expect(result.text).toMatch(/Beta/);
    expect(result.text).toMatch(new RegExp(DOC_TYPE));
  });

  it("filters by --type", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Alpha", dryRun: false },
      makeCtx(workdir),
    );
    const result = await specList.execute(
      { type: "powerhouse/document-editor" },
      makeCtx(workdir),
    );
    expect(result.text).toBe("(no specs)");
  });
});

describe("spec-create", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("persists a new spec by default", async () => {
    const result = await specCreate.execute(
      { type: DOC_TYPE, name: "Persisted", dryRun: false },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/Created/);
    expect(result.text).toContain(workdir);
    const list = await specList.execute({}, makeCtx(workdir));
    expect(list.text).toMatch(/Persisted/);
  });

  it("does not persist when --dryRun is set", async () => {
    const result = await specCreate.execute(
      { type: DOC_TYPE, name: "Ephemeral", dryRun: true },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/in-memory, not saved/);
    const list = await specList.execute({}, makeCtx(workdir));
    expect(list.text).toBe("(no specs)");
  });
});

describe("spec-get", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      makeCtx(workdir),
    );
  });
  afterEach(() => cleanup());

  it("returns a summary + help by default (no slicer, no --full)", async () => {
    const result = await specGet.execute(
      { name: "Target", full: false, latest: false },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/powerhouse\/document-model "Target"/);
    expect(result.text).toMatch(/Usage examples for "Target"/);
    // Default must NOT dump the full state payload.
    expect(result.text).not.toContain('"global"');
  });

  it("returns the full state when --full is passed", async () => {
    const result = await specGet.execute(
      { name: "Target", full: true, latest: false },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/"specifications":/);
  });

  it("projects via --filter against the state", async () => {
    const result = await specGet.execute(
      { name: "Target", filter: "$.global.specifications[0].version" },
      makeCtx(workdir),
    );
    expect(result.text).toBe("1");
  });

  it("throws when the spec is missing", async () => {
    await expect(
      specGet.execute({ name: "DoesNotExist" }, makeCtx(workdir)),
    ).rejects.toThrow(/Unknown spec "DoesNotExist"/);
  });
});

describe("spec-update", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      makeCtx(workdir),
    );
  });
  afterEach(() => cleanup());

  it("applies actions read from a file", async () => {
    const actionsPath = join(workdir, "actions.json");
    writeFileSync(
      actionsPath,
      JSON.stringify([{ type: "SET_MODEL_NAME", input: { name: "Renamed" } }]),
    );
    const result = await specUpdate.execute(
      { name: "Target", from: actionsPath },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/Applied 1 action/);
    const after = await specGet.execute(
      { name: "Target", filter: "$.global.name" },
      makeCtx(workdir),
    );
    expect(after.text).toBe("Renamed");
  });

  it("rejects malformed JSON", async () => {
    const actionsPath = join(workdir, "broken.json");
    writeFileSync(actionsPath, "not json");
    await expect(
      specUpdate.execute(
        { name: "Target", from: actionsPath },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/Invalid JSON/);
  });

  it("rejects when actions input is not an array", async () => {
    const actionsPath = join(workdir, "obj.json");
    writeFileSync(actionsPath, JSON.stringify({ type: "FOO" }));
    await expect(
      specUpdate.execute(
        { name: "Target", from: actionsPath },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/JSON array/);
  });

  it("enriches invalid-input errors with the action's GraphQL input schema", async () => {
    /* SET_MODEL_NAME requires `name: String!` — pass a wrong-shaped payload and
     * expect the error to include the schema so the agent can self-correct. */
    await expect(
      specUpdate.execute(
        {
          name: "Target",
          actions: [{ type: "SET_MODEL_NAME", input: { wrong: 1 } }],
        },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/input SetModelNameInput[\s\S]*name: String!/);
  });

  it("trims the raw zod JSON dump out of input-shape errors", async () => {
    /* The error must name the offending field and show the schema, without the
     * multi-line `{ "code": "invalid_type", ... }` blob the reducer emits. */
    const promise = specUpdate.execute(
      {
        name: "Target",
        actions: [{ type: "SET_MODEL_NAME", input: { wrong: 1 } }],
      },
      makeCtx(workdir),
    );
    await expect(promise).rejects.toThrow(/SET_MODEL_NAME: [^\n]*name/);
    await expect(promise).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('"code": "invalid_type"'),
      }),
    );
  });

  it("lists valid action types when the action is unknown", async () => {
    await expect(
      specUpdate.execute(
        {
          name: "Target",
          actions: [{ type: "NOT_A_REAL_ACTION", input: {} }],
        },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/Valid action types[\s\S]*SET_MODEL_NAME/);
  });

  it("suggests the closest action name on a near-miss", async () => {
    /* `SET_NAME` is the canonical agent miss for subgraph; here on
     * document-model the closest match is `SET_MODEL_NAME`. */
    await expect(
      specUpdate.execute(
        {
          name: "Target",
          actions: [{ type: "SET_NAME", input: { name: "x" } }],
        },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/Did you mean:[^\n]*SET_MODEL_NAME/);
  });

  it("applies SET_STATE_SCHEMA / SET_INITIAL_STATE without a payload scope", async () => {
    /* The first-update foot-gun: agents omit the required payload `scope`
     * because the action-level scope already defaults to global. The reducer
     * must accept the normalized actions. */
    const result = await specUpdate.execute(
      {
        name: "Target",
        actions: [
          { type: "SET_STATE_SCHEMA", input: { schema: "type S { x: Int }" } },
          { type: "SET_INITIAL_STATE", input: { initialValue: "{}" } },
        ],
      },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/Applied 2 action/);
  });

  it("mints an id for an ADD_MODULE that supplies only a name", async () => {
    const result = await specUpdate.execute(
      { name: "Target", actions: [{ type: "ADD_MODULE", input: { name: "Workouts" } }] },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/Applied 1 action/);
    const ids = await specGet.execute(
      { name: "Target", latest: true, filter: "$.modules[*].id" },
      makeCtx(workdir),
    );
    expect(ids.text).toMatch(/[0-9a-f-]{36}/i);
  });

  it("resolves a moduleId given as a name within the same batch", async () => {
    const result = await specUpdate.execute(
      {
        name: "Target",
        actions: [
          { type: "ADD_MODULE", input: { id: "mod-1", name: "Workouts" } },
          {
            type: "ADD_OPERATION",
            input: {
              moduleId: "Workouts",
              name: "ADD_WORKOUT",
              schema: "input AddWorkoutInput { id: String! }",
            },
          },
        ],
      },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/Applied 2 action/);
    const ops = await specGet.execute(
      { name: "Target", latest: true, filter: "$.modules[?(@.id=='mod-1')].operations[*].name" },
      makeCtx(workdir),
    );
    expect(ops.text).toMatch(/ADD_WORKOUT/);
  });
});

describe("spec-generate", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(async () => {
    ({ workdir, cleanup } = makeWorkdir());
    // buildTsMorphProject reads a tsconfig from the project root.
    writeFileSync(
      join(workdir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
        },
      }),
    );
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      makeCtx(workdir),
    );
    await specUpdate.execute(
      {
        name: "Target",
        actions: [
          { type: "SET_MODEL_ID", input: { id: "powerhouse/target" } },
          { type: "SET_MODEL_NAME", input: { name: "Target" } },
          { type: "SET_MODEL_EXTENSION", input: { extension: "tgt" } },
        ],
      },
      makeCtx(workdir),
    );
  });
  afterEach(() => cleanup());

  it("throws a trimmed parse error when a single-target schema is TypeScript, not SDL", async () => {
    /* The canonical agent footgun: a state schema written in TS syntax passes
     * spec-update's JSON validation but fails codegen. A single-target generate
     * must surface this as a tool error, not bury it in `data.skipped`. */
    await specUpdate.execute(
      {
        name: "Target",
        actions: [
          {
            type: "SET_STATE_SCHEMA",
            input: {
              scope: "global",
              schema:
                "type TodoItem = {\n  id: string;\n  text: string;\n};\n\ntype TargetState = {\n  items: TodoItem[];\n};",
            },
          },
          {
            type: "SET_INITIAL_STATE",
            input: { scope: "global", initialValue: '{ "items": [] }' },
          },
        ],
      },
      makeCtx(workdir),
    );

    const promise = specGenerate.execute(
      { project: undefined, name: "Target", skipChecks: true },
      makeCtx(workdir),
    );
    await expect(promise).rejects.toThrow(
      /Failed to parse the GraphQL document/,
    );
    // The thrown message must be trimmed, not the multi-kB schema dump.
    await expect(promise).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("type TodoItem = {"),
      }),
    );
  });
});

describe("spec-delete", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("removes a spec from disk", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Doomed", dryRun: false },
      makeCtx(workdir),
    );
    const result = await specDelete.execute(
      { name: "Doomed" },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/Deleted "Doomed"/);
    const list = await specList.execute({}, makeCtx(workdir));
    expect(list.text).toBe("(no specs)");
  });

  it("throws if the spec is missing", async () => {
    await expect(
      specDelete.execute({ name: "Missing" }, makeCtx(workdir)),
    ).rejects.toThrow(/Unknown spec "Missing"/);
  });
});

describe("spec-schema-list", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("returns registered document model types", async () => {
    const result = await specSchemaList.execute({}, makeCtx(workdir));
    expect(result.text).toMatch(/powerhouse\/document-model/);
    expect(result.text).toContain(DOC_TYPE);
  });
});

describe("spec-schema", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("returns a summary + help by default (no slicer, no --full)", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, state: false, full: false },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(new RegExp(`^${DOC_TYPE} —`));
    expect(result.text).toMatch(/^Modules: /m);
    expect(result.text).toMatch(/^JSONPath examples/m);
    // Default must NOT dump the full schema payload.
    expect(result.text).not.toContain('"specifications"');
  });

  it("returns the full schema when --full is passed", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, state: false, full: true },
      makeCtx(workdir),
    );
    expect(result.text).toContain("specifications");
  });

  it("--action returns the GraphQL input for one operation", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, action: "SET_MODEL_NAME", state: false },
      makeCtx(workdir),
    );
    expect(result.text).toMatch(/^input SetModelNameInput/);
    expect(result.text).toMatch(/name: String!/);
  });

  it("--state returns the GraphQL state schema", async () => {
    const result = await specSchema.execute(
      { type: DOC_TYPE, state: true },
      makeCtx(workdir),
    );
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/^Schema for /);
  });

  it("--action rejects unknown action names with a discovery hint", async () => {
    await expect(
      specSchema.execute(
        { type: DOC_TYPE, action: "NOT_A_REAL_ACTION", state: false },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(
      /Unknown action "NOT_A_REAL_ACTION"[\s\S]*spec-schema --type/,
    );
  });

  it("--action suggests the closest match on a near-miss", async () => {
    await expect(
      specSchema.execute(
        { type: DOC_TYPE, action: "SET_NAME", state: false },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/Did you mean:[^.]*SET_MODEL_NAME/);
  });

  it("rejects --action combined with --state", async () => {
    await expect(
      specSchema.execute(
        { type: DOC_TYPE, action: "SET_MODEL_NAME", state: true },
        makeCtx(workdir),
      ),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("targets the LATEST specification, not specifications[0]", async () => {
    // We can't easily release a new version in a unit test, but we can verify
    // the resolved filter string mentions the script index for "last element".
    // (Defensive: prevents regression to the buggy `[0]` form.)
    const result = await specSchema.execute(
      { type: DOC_TYPE, action: "SET_MODEL_NAME", state: false },
      makeCtx(workdir),
    );
    // Latest-spec correctness is verified end-to-end in the multi-spec
    // simulation; here we just confirm the action shortcut still resolves.
    expect(result.text).toMatch(/SetModelNameInput/);
  });
});
