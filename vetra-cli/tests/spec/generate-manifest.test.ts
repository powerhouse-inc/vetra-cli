import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { specCreate } from "../../src/commands/spec/create.js";
import { generateInProject } from "../../src/commands/spec/generate.js";
import { specUpdate } from "../../src/commands/spec/update.js";
import { MANIFEST_FILENAME } from "../../src/helpers/project-manifest.js";
import { makeCtx, makeWorkdir } from "./_fixtures.js";

const DOC_TYPE = "powerhouse/document-model";

// A spec's `state.global.id`/`.name` start empty (spec-create only sets the
// header name); codegen takes the manifest entry from them. Generating before
// they are set used to write {"id":"","name":""} — the phantom entry found in
// the P5 staging project — so spec-generate refuses such a spec and prunes a
// placeholder an earlier run already wrote.
describe("spec-generate model identity and manifest guard", () => {
  let workdir: string;
  let cleanup: () => void;
  beforeEach(() => ({ workdir, cleanup } = makeWorkdir()));
  afterEach(() => cleanup());

  it("skips an unnamed model instead of writing a phantom manifest entry", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      makeCtx(workdir),
    );
    const run = jest.fn(async () => ({ success: true, output: "" }));
    const result = await generateInProject(
      { skipChecks: true },
      workdir,
      run as never,
    );
    expect(run).not.toHaveBeenCalled();
    expect(result.text).toMatch(/skipped 1/);
    expect(result.text).toMatch(/no name or id yet/);
    expect(result.text).toMatch(/SET_MODEL_NAME and SET_MODEL_ID/);
    expect(() => readFileSync(join(workdir, MANIFEST_FILENAME))).toThrow();
  });

  it("refuses a named generate of an unnamed model", async () => {
    await specCreate.execute(
      { type: DOC_TYPE, name: "Target", dryRun: false },
      makeCtx(workdir),
    );
    const run = jest.fn(async () => ({ success: true, output: "" }));
    await expect(
      generateInProject({ name: "Target", skipChecks: true }, workdir, run as never),
    ).rejects.toThrow(/no name or id yet/);
    expect(run).not.toHaveBeenCalled();
  });

  it("drops a placeholder an earlier run wrote when the model is regenerated", async () => {
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
        ],
      },
      makeCtx(workdir),
    );
    const manifestPath = join(workdir, MANIFEST_FILENAME);
    writeFileSync(
      manifestPath,
      JSON.stringify(
        { name: "Target", documentModels: [{ id: "", name: "" }] },
        null,
        2,
      ) + "\n",
    );
    // What `ph generate document-model` does: append its {id,name} entry.
    const run = jest.fn(async () => {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      manifest.documentModels.push({ id: "powerhouse/target", name: "Target" });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      return { success: true, output: "" };
    });

    const result = await generateInProject(
      { skipChecks: true },
      workdir,
      run as never,
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(manifestPath, "utf-8")).documentModels).toEqual([
      { id: "powerhouse/target", name: "Target" },
    ]);
    expect(result.text).toMatch(/removed 1 empty document-model entry/);
  });
});
