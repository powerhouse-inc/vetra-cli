import { afterEach, describe, expect, it } from "@jest/globals";
import { StudioProductV1 } from "vetra-app/document-models";
import { runProgress } from "../../src/commands/product/progress.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { discardedIdeas, ideaKey, sameIdea, suggestionVersion } from "../../src/product/suggestions.js";
import { productHarness, type ProductHarness } from "./helpers.js";

const a = StudioProductV1.actions;
const AT = "2026-10-20T10:05:00.000Z";

describe("product-progress suggest", () => {
  let h: ProductHarness | undefined;
  afterEach(async () => {
    await h?.kill();
    h = undefined;
  });

  it("suggest keeps 2–3 items, each at most 80 characters", async () => {
    h = await productHarness();
    expect(await runProgress(h.ctx, { action: "suggest", items: ["Only one idea"] })).toBe(
      "Refused: Give 2 to 3 suggestions in `items`.",
    );
    expect(await runProgress(h.ctx, { action: "suggest", items: ["a", "b", "c", "d"] })).toBe(
      "Refused: Give 2 to 3 suggestions in `items`.",
    );
    expect(await runProgress(h.ctx, { action: "suggest" })).toBe("Refused: Give 2 to 3 suggestions in `items`.");
    const long = "x".repeat(81);
    expect(await runProgress(h.ctx, { action: "suggest", items: ["Short idea", long] })).toBe(
      `Refused: Keep each suggestion to 80 characters: "${long}".`,
    );
    expect(await runProgress(h.ctx, { action: "suggest", items: ["Add notes", "add notes!"] })).toBe(
      "Refused: Each suggestion must be a different idea.",
    );
    expect(await runProgress(h.ctx, { action: "suggest", items: ["Add a package list", "Show an image"] })).toBe(
      "Refused: Rephrase in the customer's words without: package, image.",
    );
    expect((await h.state()).suggestions).toEqual([]);

    // Blank items are dropped and whitespace is tidied before counting.
    const ok = await runProgress(h.ctx, {
      action: "suggest",
      items: ["  Let guests see their order status ", "Add a daily summary   for the kitchen", "  "],
    });
    // During the first build the ideas belong to Version 1, the one being built.
    expect(ok).toBe("Suggestions saved for Version 1.");
    const s = await h.state();
    expect(s.suggestions.map((x) => [x.text, x.afterVersion, x.status])).toEqual([
      ["Let guests see their order status", 1, "OPEN"],
      ["Add a daily summary for the kitchen", 1, "OPEN"],
    ]);
    expect(new Set(s.suggestions.map((x) => x.id)).size).toBe(2);
  });

  it("a discarded idea is not suggested again", async () => {
    h = await productHarness();
    await dispatchProduct(h.ctx, [
      a.discardChange({ changeId: "change-1", at: AT }),
      a.startChange({ id: "change-2", kind: "FIRST_BUILD", request: "Allow allergen notes on each order", startedAt: AT }),
      a.discardChange({ changeId: "change-2", at: AT }),
      a.startChange({ id: "change-3", kind: "FIRST_BUILD", request: "a recipe box", startedAt: AT }),
      a.setSuggestions({ afterVersion: 1, items: [{ id: "s1", text: "Print a shopping list" }, { id: "s2", text: "Rate recipes" }] }),
      a.dismissSuggestion({ id: "s1" }),
    ]);

    expect(
      await runProgress(h.ctx, { action: "suggest", items: ["Allow allergen notes", "Share recipes by link"] }),
    ).toBe('Refused: The customer already discarded "Allow allergen notes"; suggest something else.');
    // A dismissed suggestion counts as thrown away too.
    expect(
      await runProgress(h.ctx, { action: "suggest", items: ["print a shopping list.", "Share recipes by link"] }),
    ).toBe('Refused: The customer already discarded "print a shopping list."; suggest something else.');
    expect(await runProgress(h.ctx, { action: "suggest", items: ["Share recipes by link", "Add cooking timers"] })).toBe(
      "Suggestions saved for Version 1.",
    );
    const open = (await h.state()).suggestions.filter((x) => x.status === "OPEN").map((x) => x.text);
    expect(open).toEqual(["Share recipes by link", "Add cooking timers"]);
  });

  it("after the launch the ideas belong to the live version; with nothing built or live it is refused", async () => {
    h = await productHarness();
    const state = await h.state();
    expect(suggestionVersion(state)).toBe(1);
    // Live on Version 2 with the change launched: ideas follow Version 2.
    const launched = {
      ...state,
      liveVersion: 2,
      changes: state.changes.map((c) => ({ ...c, status: "LAUNCHED" as const })),
    };
    expect(suggestionVersion(launched)).toBe(2);
    // A change launching as Version 3 (a retry keeps the number).
    const launching = {
      ...state,
      liveVersion: 2,
      versions: [{ ...versionStub(3), changeId: "change-1", status: "LAUNCHING" as const }],
    };
    expect(suggestionVersion(launching)).toBe(3);

    await dispatchProduct(h.ctx, [a.discardChange({ changeId: "change-1", at: AT })]);
    expect(await runProgress(h.ctx, { action: "suggest", items: ["Add cooking timers", "Rate recipes"] })).toBe(
      "Refused: Nothing is being built or live yet.",
    );
  });

  it("matches ideas by words, not by punctuation or case", () => {
    expect(ideaKey("  Let guests see their order-status! ")).toBe("let guests see their order status");
    expect(sameIdea("Allergen notes", "allergen notes.")).toBe(true);
    expect(sameIdea("Allow allergen notes", "Please allow allergen notes on each order")).toBe(true);
    // Short fragments and partial words don't count.
    expect(sameIdea("notes", "Allow allergen notes")).toBe(false);
    expect(sameIdea("Add a daily summary", "Add a daily summaryboard")).toBe(false);
    expect(sameIdea("!!!", "anything")).toBe(false);
    expect(discardedIdeas({ changes: undefined, suggestions: undefined } as never)).toEqual([]);
  });
});

function versionStub(number: number) {
  return {
    number,
    title: "t",
    summary: null,
    changeId: null,
    gitTag: `v${number}`,
    sha: "sha",
    packages: [],
    deploymentId: null,
    launchedAt: null,
    launchedBy: "vetra",
    trigger: "STUDIO_LAUNCH",
    status: "LIVE" as const,
    lines: [],
    changedFiles: [],
    failure: null,
    rollbackBlockedReason: null,
  };
}
