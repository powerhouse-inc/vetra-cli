// @vitest-environment happy-dom
import { actions } from "document-models/studio-product";
import { describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import {
  at,
  buildingOps,
  productDoc,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";
import { StepStrip, tone } from "./StepStrip.js";
import { stripModel, type StripView } from "./stripModel.js";

function view(...ops: Parameters<typeof productDoc>): StripView {
  return stripModel(readProduct(productDoc(...ops).state.global), {
    budget: { spentUsd: 0.31, limitUsd: 10 },
    averages: {},
    now: new Date(at(30)),
  });
}

describe("StepStrip", () => {
  it("strip shows working count 2/3 for DATA, icon paired with text", () => {
    const container = render(
      <StepStrip
        view={view(
          ...buildingOps(),
          actions.startStep({ changeId: "c1", kind: "DATA", at: at(3) }),
          actions.countStep({
            changeId: "c1",
            kind: "DATA",
            done: 2,
            total: 3,
          }),
        )}
        selected={null}
        onOpenStep={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const data = container.querySelector('[data-step="DATA"]');
    expect(data?.textContent).toContain("◐");
    expect(data?.textContent).toContain("Data");
    expect(data?.textContent).toContain("2/3");
    expect(container.textContent).toContain("Task board");
    expect(container.textContent).toContain("$0.31 of $10");
    expectNoForbiddenWords(container);
  });

  it("stopped step shows ✕ with text", () => {
    const container = render(
      <StepStrip
        view={view(
          ...buildingOps(),
          actions.startStep({ changeId: "c1", kind: "TESTS", at: at(3) }),
          actions.setStepAttention({
            changeId: "c1",
            kind: "TESTS",
            status: "STOPPED",
            at: at(4),
          }),
        )}
        selected={null}
        onOpenStep={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const tests = container.querySelector('[data-step="TESTS"]');
    expect(tests?.textContent).toContain("✕");
    expect(tests?.textContent).toContain("Tests");
    expect(tests?.textContent).toContain("stopped");
  });

  it("only started steps are buttons; clicking one opens it", () => {
    const onOpenStep = vi.fn();
    const onOpenSettings = vi.fn();
    const container = render(
      <StepStrip
        view={view(
          ...buildingOps(),
          actions.startStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
        )}
        selected={null}
        onOpenStep={onOpenStep}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(container.querySelector('button[data-step="PLAN"]')).not.toBeNull();
    expect(container.querySelector('button[data-step="DATA"]')).toBeNull();
    click(container.querySelector('button[data-step="PLAN"]'));
    expect(onOpenStep).toHaveBeenCalledWith("PLAN");
    click(button(container, "Settings"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("colours follow the spec: Live green, working and needs-you distinct", () => {
    expect(tone("●")).toContain("bg-success");
    expect(tone("✓")).toContain("text-success");
    expect(tone("◐")).toContain("yellow");
    expect(tone("!")).toContain("bg-warning");
    expect(tone("✕")).toContain("destructive");
    const all = (["○", "◐", "✓", "!", "✕", "●"] as const).map(tone);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("StepStrip — the live product", () => {
  it("live-strip copy: ● Live · the address, then Deployed … · GitHub", () => {
    const product = readProduct(
      withLiveVersion(productDoc(...buildingOps()), {
        launchedAt: at(25),
      }).state.global,
    );
    const liveView = stripModel(product, {
      budget: { spentUsd: 0.31, limitUsd: 10 },
      averages: {},
      now: new Date(at(30)),
    });
    const container = render(
      <StepStrip
        view={liveView}
        selected={null}
        onOpenStep={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const text = container.textContent;
    expect(text).toContain("●Live");
    expect(text).toContain("·task-board.vetra.io ↗");
    for (const step of ["PLAN", "DATA", "EDITORS", "TESTS"]) {
      expect(
        container.querySelector(`[data-step="${step}"]`)?.textContent,
      ).toContain("✓");
    }
    expect(text).toContain(
      "Deployed 5 min ago · Code saved in your Studio · Connect GitHub",
    );
    expectNoForbiddenWords(container);
  });
});
