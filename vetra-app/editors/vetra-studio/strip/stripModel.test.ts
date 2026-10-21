import { actions } from "document-models/studio-product";
import { describe, expect, it } from "vitest";
import {
  at,
  buildingOps,
  productDoc,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";
import { readProduct } from "../shell/useStudioState.js";
import { changing } from "../change/changeFixtures.js";
import { withFailure } from "../failures/failureStates.js";
import {
  budgetText,
  deployedAgo,
  stripModel,
  type StripInputs,
  type StripView,
} from "./stripModel.js";

const NOW = new Date(at(30));
const INPUTS: StripInputs = {
  budget: { spentUsd: 0.31, limitUsd: 10 },
  averages: {},
  now: NOW,
};

function strip(...ops: Parameters<typeof productDoc>): StripView {
  return stripModel(readProduct(productDoc(...ops).state.global), INPUTS);
}

function step(view: StripView, kind: string) {
  const found = view.steps.find((s) => s.kind === kind);
  if (!found) throw new Error(`no ${kind}`);
  return found;
}

const generated = actions.recordCheckRun({
  changeId: "c1",
  id: "run-1",
  at: at(5),
  results: [{ kind: "GENERATE", passed: true }],
});

describe("stripModel", () => {
  it("strip shows working count 2/3 for DATA", () => {
    const view = strip(
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "DATA", at: at(3) }),
      actions.countStep({ changeId: "c1", kind: "DATA", done: 2, total: 3 }),
    );
    expect(step(view, "DATA")).toMatchObject({
      icon: "◐",
      label: "Data",
      count: "2/3",
      stateText: "working",
      clickable: true,
    });
    expect(step(view, "TESTS")).toMatchObject({
      icon: "○",
      clickable: false,
    });
    expect(step(view, "TESTS").count).toBeUndefined();
  });

  it("plan shows the number of planned features while active", () => {
    const view = strip(
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
    );
    expect(step(view, "PLAN").count).toBe("9 features");
    expect(view.name).toBe("Task board");
  });

  it("a reopened step shows ◐ again", () => {
    const done = [
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "DATA", at: at(3) }),
      generated,
      actions.completeStep({ changeId: "c1", kind: "DATA", at: at(6) }),
    ];
    expect(step(strip(...done), "DATA")).toMatchObject({
      icon: "✓",
      stateText: "done",
    });
    expect(step(strip(...done), "DATA").count).toBeUndefined();

    const reopened = strip(
      ...done,
      actions.reopenStep({
        changeId: "c1",
        kind: "DATA",
        reason: "the due-date check failed",
        at: at(9),
      }),
    );
    expect(step(reopened, "DATA")).toMatchObject({
      icon: "◐",
      stateText: "working",
      count: "3/3",
    });
  });

  it("stopped step shows ✕ with text", () => {
    const view = strip(
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "TESTS", at: at(3) }),
      actions.setStepAttention({
        changeId: "c1",
        kind: "TESTS",
        status: "STOPPED",
        reason: "the AI service didn't respond",
        at: at(4),
      }),
    );
    expect(step(view, "TESTS")).toMatchObject({
      icon: "✕",
      label: "Tests",
      stateText: "stopped",
      clickable: true,
    });
  });

  it("needs-you shows ! and live working shows Going live…", () => {
    const view = strip(
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "EDITORS", at: at(3) }),
      actions.setStepAttention({
        changeId: "c1",
        kind: "EDITORS",
        status: "NEEDS_YOU",
        at: at(4),
      }),
      actions.startStep({ changeId: "c1", kind: "LIVE", at: at(5) }),
    );
    expect(step(view, "EDITORS")).toMatchObject({
      icon: "!",
      stateText: "needs you",
    });
    expect(step(view, "LIVE")).toMatchObject({
      icon: "◐",
      count: "Going live…",
    });
  });

  it("no product yet: every step not started, budget on the right", () => {
    const view = stripModel(null, INPUTS);
    expect(view.name).toBe("Your product");
    expect(view.steps.map((s) => s.icon).join("")).toBe("○○○○○");
    expect(view.steps.every((s) => !s.clickable)).toBe(true);
    expect(view.right).toEqual({ budget: "$0.31 of $10" });
  });

  it("live product: ● Live with the address, deployed time and GitHub", () => {
    const product = readProduct(productDoc(...buildingOps()).state.global);
    product.liveVersion = 1;
    product.liveUrl = "https://task-board.vetra.io";
    product.versions.push({
      number: 1,
      title: "First version",
      summary: null,
      changeId: "c1",
      gitTag: "v1",
      sha: "abc",
      packages: [],
      deploymentId: null,
      launchedAt: at(28),
      launchedBy: "Vetra",
      trigger: "AUTO",
      status: "LIVE",
      lines: [],
      changedFiles: [],
      failure: null,
      rollbackBlockedReason: null,
    });
    const view = stripModel(product, INPUTS);
    expect(step(view, "LIVE")).toMatchObject({ icon: "●", clickable: true });
    expect(view.right).toEqual({
      liveUrl: "https://task-board.vetra.io",
      deployedAgo: "Deployed 2 min ago",
      github: "Code saved in your Studio · Connect GitHub",
    });
  });

  it("deployed time reads liveSince, not the launch record", () => {
    const product = readProduct(
      withLiveVersion(productDoc(...buildingOps()), {
        launchedAt: at(2),
      }).state.global,
    );
    product.liveSince = at(25);
    const view = stripModel(product, INPUTS);
    expect("liveUrl" in view.right && view.right.deployedAgo).toBe(
      "Deployed 5 min ago",
    );
  });

  it("a change on the live product: ● Live · v1 and the change's progress", () => {
    const view = stripModel(changing("BUILDING"), INPUTS);
    // Live mode: the live version's steps, its number on Live.
    expect(view.steps.map((s) => s.icon).join("")).toBe("✓✓✓✓●");
    expect(step(view, "LIVE").count).toBe("· v1");
    expect(view.right).toMatchObject({
      liveUrl: "https://task-board.vetra.io",
    });
    expect(view.change).toEqual({
      icon: "◐",
      text: "Change: Data 1/1 · Editors · Tests",
    });
    expect(stripModel(changing("READY"), INPUTS).change).toEqual({
      icon: "✓",
      text: "Change: Data ✓ · Editors ✓ · Tests ✓",
    });
    expect(stripModel(changing("LAUNCHING"), INPUTS).change).toEqual({
      icon: "◐",
      text: "Change: Going live…",
    });
    // A build step's failure marks the change's line, not the live pills.
    const marked = withFailure(view, {
      situation: "budget-used-up",
      stripStep: "EDITORS",
      stripIcon: "!",
      text: "",
      actions: [],
    });
    expect(marked.change?.icon).toBe("!");
    expect(step(marked, "EDITORS").icon).toBe("✓");
    // No change open: no progress next to Live.
    const live = readProduct(
      withLiveVersion(productDoc(...buildingOps())).state.global,
    );
    expect(stripModel(live, INPUTS).change).toBeUndefined();
  });

  it("an unhealthy live app turns Live amber", () => {
    const product = readProduct(
      withLiveVersion(productDoc(...buildingOps())).state.global,
    );
    product.health = "UNHEALTHY";
    expect(step(stripModel(product, INPUTS), "LIVE")).toMatchObject({
      icon: "!",
      stateText: "not responding",
    });
  });

  it("formats budget and deployed times", () => {
    expect(budgetText(null)).toBe("");
    expect(budgetText({ spentUsd: 1.5, limitUsd: null })).toBe("$1.50 used");
    expect(budgetText({ spentUsd: 0, limitUsd: 12.5 })).toBe("$0.00 of $12.50");
    expect(deployedAgo(null, NOW)).toBe("Deployed");
    expect(deployedAgo(at(30), NOW)).toBe("Deployed just now");
    expect(
      deployedAgo(new Date(NOW.getTime() - 3 * 3600_000).toISOString(), NOW),
    ).toBe("Deployed 3 h ago");
    expect(
      deployedAgo(new Date(NOW.getTime() - 26 * 3600_000).toISOString(), NOW),
    ).toBe("Deployed 1 day ago");
  });

  it("budget and time left while building, never above the last estimate", () => {
    const product = readProduct(
      productDoc(
        ...buildingOps(),
        actions.completeStep({ changeId: "c1", kind: "PLAN", at: at(29) }),
      ).state.global,
    );
    const averages = { model: 60, editor: 60, check: 60 };
    // 3 models + 3 screens + 1 check, 1 min in → 6 min.
    const view = stripModel(product, { ...INPUTS, averages });
    expect(view.right).toEqual({
      budget: "$0.31 of $10",
      timeLeft: "~6 min left",
    });
    const held = stripModel(product, {
      ...INPUTS,
      averages,
      prevTimeLeft: "~4 min left",
    });
    expect(held.right).toEqual({
      budget: "$0.31 of $10",
      timeLeft: "~4 min left",
    });
  });
});
