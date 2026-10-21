import { afterEach, describe, expect, it } from "@jest/globals";
import { StudioProductV1 } from "vetra-app/document-models";
import { runProgress } from "../../src/commands/product/progress.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { FORBIDDEN_WORDS } from "../../src/product/forbidden-words.js";
import { productHarness, type ProductHarness } from "./helpers.js";

const a = StudioProductV1.actions;

describe("product-progress", () => {
  let h: ProductHarness | undefined;
  afterEach(async () => {
    await h?.kill();
    h = undefined;
  });

  it("progress plan creates steps on the active change", async () => {
    h = await productHarness();
    const text = await runProgress(h.ctx, {
      action: "plan",
      steps: [{ kind: "PLAN" }, { kind: "DATA", total: 2 }, { kind: "EDITORS" }, { kind: "TESTS" }],
    });
    expect(text).toBe("Planned Plan → Data → Editors → Tests.");
    const change = (await h.state()).changes[0];
    expect(change.steps.map((s) => [s.kind, s.status, s.total])).toEqual([
      ["PLAN", "NOT_STARTED", null],
      ["DATA", "NOT_STARTED", 2],
      ["EDITORS", "NOT_STARTED", null],
      ["TESTS", "NOT_STARTED", null],
    ]);

    await runProgress(h.ctx, { action: "start", step: "DATA", label: "Tasks" });
    await runProgress(h.ctx, { action: "count", step: "DATA", done: 1, total: 2 });
    const data = (await h.state()).changes[0].steps[1];
    expect([data.status, data.label, data.done, data.total]).toEqual(["WORKING", "Tasks", 1, 2]);
  });

  it("progress done TESTS returns the gate message when checks did not run", async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "TESTS" }] });
    const text = await runProgress(h.ctx, { action: "done", step: "TESTS" });
    expect(text).toBe("Refused: Tests can't be done: no GENERATE result in this change.");
    const state = await h.state();
    expect(state.changes[0].steps[0].status).toBe("NOT_STARTED");
  });

  it("done TESTS succeeds once every check passed in this change", async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "TESTS" }] });
    await dispatchProduct(h.ctx, [
      a.recordCheckRun({
        changeId: "change-1",
        id: "run-1",
        at: "2026-10-20T10:01:00.000Z",
        results: [
          { kind: "GENERATE", passed: true },
          { kind: "TYPECHECK", passed: true },
          { kind: "LINT", passed: true },
          { kind: "REDUCER_TESTS", passed: true },
          { kind: "SMOKE", passed: true },
        ],
      }),
    ]);
    expect(await runProgress(h.ctx, { action: "done", step: "TESTS" })).toBe("Tests done.");
    expect((await h.state()).changes[0].steps[0].status).toBe("DONE");
  });

  it("done PLAN is refused until the product is named and the change titled, then allowed", async () => {
    // INIT_PRODUCT name = placeholderName(idea) → "Create a todo app".
    h = await productHarness({ name: "Create a todo app" });
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "PLAN" }] });
    expect(await runProgress(h.ctx, { action: "done", step: "PLAN" })).toBe(
      "Refused: Choose the product name first (product-progress name).",
    );
    expect(await runProgress(h.ctx, { action: "name", text: "Team Tasks" })).toBe(
      'Product named "Team Tasks".',
    );
    expect(await runProgress(h.ctx, { action: "done", step: "PLAN" })).toBe(
      "Refused: Title this change first (product-progress title).",
    );
    expect((await h.state()).changes[0].steps[0].status).not.toBe("DONE");
    await runProgress(h.ctx, { action: "title", text: "First version" });
    expect(await runProgress(h.ctx, { action: "done", step: "PLAN" })).toBe("Plan done.");
    expect((await h.state()).name).toBe("Team Tasks");
  });

  it("title, milestone, back and stuck write the active change", async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "PLAN" }] });
    await runProgress(h.ctx, { action: "name", text: "Team Tasks" });
    expect(await runProgress(h.ctx, { action: "title", text: "First version" })).toBe(
      'Change titled "First version".',
    );
    await runProgress(h.ctx, { action: "done", step: "PLAN" });
    expect(await runProgress(h.ctx, { action: "milestone", text: "Tasks can be added" })).toBe(
      "Milestone recorded.",
    );
    // Back from the finished change (LIVE tools) to PLAN: its tools return.
    expect(await runProgress(h.ctx, { action: "back", step: "PLAN", reason: "Add due dates" })).toMatch(
      /^Back to Plan\. Now available: spec-create, .*reactor-project-init/,
    );
    expect(
      await runProgress(h.ctx, { action: "stuck", reason: "Dates do not save", tried: ["a", "b", "c"] }),
    ).toBe("Marked as stuck; the customer will be asked for help.");
    const change = (await h.state()).changes[0];
    expect(change.title).toBe("First version");
    expect(change.milestones.map((m) => m.text)).toEqual(["Tasks can be added"]);
    expect(change.steps[0]).toMatchObject({ status: "WORKING", reason: "Add due dates" });
    expect(change.stuck).toMatchObject({ reason: "Dates do not save", tried: ["a", "b", "c"] });
  });

  it("rejects text with a forbidden word and writes nothing", async () => {
    h = await productHarness();
    for (const action of ["milestone", "title", "name"] as const) {
      expect(await runProgress(h.ctx, { action, text: "Published the Package" })).toBe(
        "Refused: Rephrase in the customer's words without: package.",
      );
    }
    expect(
      await runProgress(h.ctx, { action: "stuck", reason: "Cannot load", tried: ["restart the Switchboard"] }),
    ).toBe("Refused: Rephrase in the customer's words without: switchboard.");
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "PLAN" }] });
    expect(await runProgress(h.ctx, { action: "start", step: "PLAN", label: "Set up the environment" })).toBe(
      "Refused: Rephrase in the customer's words without: environment.",
    );
    expect(await runProgress(h.ctx, { action: "back", step: "PLAN", reason: "New Docker image" })).toBe(
      "Refused: Rephrase in the customer's words without: image.",
    );
    const state = await h.state();
    expect(state.name).toBe("Create a todo app");
    expect(state.changes[0]).toMatchObject({ title: null, milestones: [], stuck: null });
    expect(state.changes[0].steps[0]).toMatchObject({ status: "NOT_STARTED", label: null });
    expect(FORBIDDEN_WORDS).toContain("device code");
  });

  it("names every forbidden word in one refusal", async () => {
    h = await productHarness();
    expect(
      await runProgress(h.ctx, {
        action: "stuck",
        reason: "The registry rejects the package",
        tried: ["new environment", "another package"],
      }),
    ).toBe("Refused: Rephrase in the customer's words without: package, registry, environment.");
    expect((await h.state()).changes[0].stuck).toBeNull();
  });

  it("start and done name the tools that just became available", async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "PLAN" }, { kind: "DATA" }, { kind: "TESTS" }] });
    // Already on the PLAN tools: nothing new.
    expect(await runProgress(h.ctx, { action: "start", step: "PLAN" })).toBe("Plan started.");
    await runProgress(h.ctx, { action: "name", text: "Team Tasks" });
    await runProgress(h.ctx, { action: "title", text: "First version" });
    const done = await runProgress(h.ctx, { action: "done", step: "PLAN" });
    expect(done).toMatch(/^Plan done\. Now available: /);
    for (const tool of ["mastra_workspace_write_file", "mastra_workspace_execute_command", "reactor-project-check"]) {
      expect(done).toContain(tool);
    }
    // Tools PLAN already had are not repeated.
    expect(done).not.toContain("reactor-project-init");
    expect(done).not.toContain("spec-create");
    const started = await runProgress(h.ctx, { action: "start", step: "DATA" });
    expect(started).toBe("Data started.");
  });

  it("stuck is refused when the reason claims a tool this step has", async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "PLAN" }, { kind: "DATA" }] });
    await runProgress(h.ctx, { action: "start", step: "PLAN" });
    // The staging wording: the init tool was in the tool list at the time.
    expect(
      await runProgress(h.ctx, {
        action: "stuck",
        reason: "no project-init/start tool is exposed in this session",
        tried: ["a", "b", "c"],
      }),
    ).toBe("Refused: reactor-project-init is available in this step — use it.");
    expect(
      await runProgress(h.ctx, {
        action: "stuck",
        reason: "reactor-project-init is missing and there is no reactor-project-start tool",
        tried: ["a"],
      }),
    ).toBe("Refused: reactor-project-init, reactor-project-start are available in this step — use them.");
    expect(
      await runProgress(h.ctx, { action: "stuck", reason: "there is no reactor-project-init tool", tried: ["a"] }),
    ).toBe("Refused: reactor-project-init is available in this step — use it.");
    expect((await h.state()).changes[0].stuck).toBeNull();
    // The same reason again is accepted: the refusal never leaves the agent without a way out.
    expect(
      await runProgress(h.ctx, { action: "stuck", reason: "there is no reactor-project-init tool", tried: ["a"] }),
    ).toBe("Marked as stuck; the customer will be asked for help.");
  });

  it("stuck accepts a real failure that names a tool", async () => {
    h = await productHarness();
    await runProgress(h.ctx, { action: "plan", steps: [{ kind: "PLAN" }] });
    await runProgress(h.ctx, { action: "start", step: "PLAN" });
    expect(
      await runProgress(h.ctx, {
        action: "stuck",
        reason: "spec-generate keeps failing: missing type TodoItem in the model",
        tried: ["a", "b", "c"],
      }),
    ).toBe("Marked as stuck; the customer will be asked for help.");
  });

  it("name is refused once the product has a live version", async () => {
    h = await productHarness();
    const get = h.module.client.get.bind(h.module.client);
    // Simulate a launched product: liveVersion is set by the launch module.
    const ctx = {
      ...h.ctx,
      reactor: async () => ({
        client: {
          ...h!.module.client,
          get: async (id: string) => {
            const doc = (await get(id)) as { state: { global: Record<string, unknown> } };
            if (id === h!.productId) doc.state.global.liveVersion = 1;
            return doc;
          },
          execute: h!.module.client.execute.bind(h!.module.client),
        },
        personalDriveId: h!.driveId,
      }),
    };
    expect(await runProgress(ctx, { action: "name", text: "New Name" })).toBe(
      "Refused: The live address is fixed; the name can change in Settings.",
    );
  });

  it("missing product or input is explained", async () => {
    h = await productHarness({ product: false });
    expect(await runProgress(h.ctx, { action: "suggest", items: ["x", "y"] })).toBe(
      "There is no product in this Studio yet; nothing was recorded.",
    );
    expect(await runProgress(h.ctx, { action: "plan", steps: [{ kind: "PLAN" }] })).toBe(
      "There is no product in this Studio yet; nothing was recorded.",
    );
    expect(await runProgress({}, { action: "start", step: "PLAN" })).toBe(
      "There is no product in this Studio yet; nothing was recorded.",
    );
  });

  it("a reducer refusal is returned and writes no errored operation", async () => {
    h = await productHarness();
    const before = await h.module.client.getOperations(h.productId!);
    expect(await runProgress(h.ctx, { action: "start", step: "EDITORS" })).toBe(
      'Refused: Step EDITORS is not planned in change "change-1".',
    );
    expect(await runProgress(h.ctx, { action: "count", step: "PLAN" })).toBe(
      "Refused: `done` and `total` are required for count.",
    );
    const after = await h.module.client.getOperations(h.productId!);
    expect(after.results.length).toBe(before.results.length);
  });
});
