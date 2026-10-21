// @vitest-environment happy-dom
import type {
  StudioProductState,
  Version,
} from "document-models/studio-product";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { StepStrip } from "../strip/StepStrip.js";
import { stripModel } from "../strip/stripModel.js";
import { PHASE_AVERAGES } from "../strip/timeLeft.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, pressKey, render } from "../test-utils/render.js";
import {
  buildingOps,
  productDoc,
  version,
} from "../test-utils/studioFixtures.js";
import {
  GoBackConfirm,
  VersionsPanel,
  useVersionsPanel,
} from "./VersionsPanel.js";

const NOW = new Date(2026, 9, 21, 15, 0);
const local = (day: number, h: number, m: number) =>
  new Date(2026, 9, day, h, m).toISOString();
const BLOCKED =
  "Can't go back automatically: Version 3 added data your users have already used. Ask the agent to undo the change instead.";
const CONFIRM_2 =
  "Make Version 2 live again? Your users' documents stay as they are. Changes made after Version 2 aren't deleted — you can come back to Version 4 any time.";

function product(
  edit: (g: StudioProductState) => void = () => {},
): StudioProductState {
  const doc = productDoc(...buildingOps());
  const g = doc.state.global;
  g.changes[0].status = "LAUNCHED";
  const v = (n: number, at: string, o: Partial<Version>) =>
    version(n, at, {
      status: "PREVIOUS",
      deploymentId: `dep-${n}`,
      launchedBy: "frank",
      ...o,
    });
  g.versions = [
    v(1, local(20, 9, 30), { title: "First version", launchedBy: "vetra" }),
    v(2, local(20, 11, 0), { title: "QR code on each table" }),
    v(3, local(21, 11, 40), {
      title: "Ready column",
      summary: "Adds a Ready column.",
      changedFiles: ["editors/board/editor.tsx"],
    }),
    v(4, local(21, 14, 2), { title: "Notes for the kitchen", status: "LIVE" }),
    v(5, local(21, 14, 30), { title: "Broken", status: "FAILED" }),
  ];
  g.liveVersion = 4;
  g.liveSince = local(21, 14, 2);
  g.liveUrl = "https://kitchen.vetra.io";
  edit(g);
  return readProduct(g);
}

function rowOf(container: HTMLElement, n: number): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-version="${n}"]`);
  if (!row) throw new Error(`no row for Version ${n}`);
  return row;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function panel(
  p: StudioProductState,
  over: Partial<Parameters<typeof VersionsPanel>[0]> = {},
) {
  return render(
    <VersionsPanel
      product={p}
      now={NOW}
      onGoBack={() => {}}
      onUndo={() => {}}
      onClose={() => {}}
      {...over}
    />,
  );
}

describe("VersionsPanel", () => {
  it("every launch is listed, newest first, live marked", () => {
    const onGoBack = vi.fn();
    const container = panel(product(), { onGoBack });
    const numbers = Array.from(
      container.querySelectorAll("[data-version]"),
    ).map((el) => el.getAttribute("data-version"));
    expect(numbers).toEqual(["4", "3", "2", "1"]);
    const live = rowOf(container, 4);
    expect(live.getAttribute("data-live")).toBe("true");
    expect(live.textContent).toContain("Live · today 14:02 · you");
    expect(button(live, "Go back")).toBeUndefined();
    expect(rowOf(container, 1).textContent).toContain(
      "yesterday · built by Vetra",
    );
    expect(container.textContent).not.toContain("Broken");

    // What changed opens on demand.
    expect(container.textContent).not.toContain("Adds a Ready column.");
    click(button(rowOf(container, 3), "What changed"));
    expect(rowOf(container, 3).textContent).toContain("Adds a Ready column.");
    expect(rowOf(container, 3).textContent).toContain(
      "editors/board/editor.tsx",
    );

    click(button(rowOf(container, 2), "Go back"));
    expect(onGoBack).toHaveBeenCalledWith(2);
    expectNoForbiddenWords(container);
  });

  it("go back confirmation text", async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    const onCancel = vi.fn();
    const container = render(
      <GoBackConfirm
        product={product()}
        target={2}
        onConfirm={onConfirm}
        onUndo={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(container.textContent).toContain(CONFIRM_2);
    expectNoForbiddenWords(container);
    const go = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Go back",
    );
    click(go);
    await settle();
    expect(onConfirm).toHaveBeenCalledWith(2);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a Go back the agent refuses on click says so plainly", async () => {
    const container = render(
      <GoBackConfirm
        product={product()}
        target={2}
        onConfirm={() =>
          Promise.reject(new Error("Couldn't go back. Try again."))
        }
        onUndo={() => {}}
        onCancel={() => {}}
      />,
    );
    click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Go back",
      ),
    );
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't go back. Try again.",
    );
  });

  it("blocked row offers Undo with the agent", async () => {
    const p = product((g) => {
      g.versions[1].rollbackBlockedReason = BLOCKED;
    });
    const onUndo = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    const container = panel(p, { onUndo, onClose });
    const row = rowOf(container, 2);
    expect(row.textContent).toContain(BLOCKED);
    // F26: never a plain Go back on a blocked row.
    expect(button(row, "Go back")).toBeUndefined();
    click(button(row, "Undo with the agent"));
    await settle();
    expect(onUndo).toHaveBeenCalledWith("Ready column");
    expect(onClose).toHaveBeenCalledTimes(1);
    expectNoForbiddenWords(container);

    // The banner's Go back to a blocked version gets the same answer.
    const confirm = render(
      <GoBackConfirm
        product={p}
        target={2}
        onConfirm={() => {}}
        onUndo={onUndo}
        onCancel={() => {}}
      />,
    );
    expect(confirm.textContent).toContain(BLOCKED);
    expect(confirm.textContent).not.toContain("Make Version 2 live again?");
    click(button(confirm, "Undo with the agent"));
    await settle();
    expect(onUndo).toHaveBeenLastCalledWith("Ready column");
  });

  it("go back disabled during a change", () => {
    const p = product((g) => {
      g.changes[0].status = "BUILDING";
    });
    const onGoBack = vi.fn();
    const container = panel(p, { onGoBack });
    expect(container.querySelector("[data-disabled-reason]")?.textContent).toBe(
      "Finish or discard your change first.",
    );
    const go = button(rowOf(container, 2), "Go back");
    expect(go?.disabled).toBe(true);
    click(go);
    expect(onGoBack).not.toHaveBeenCalled();

    // The banner's Go back is checked the same way.
    const confirm = render(
      <GoBackConfirm
        product={p}
        target={2}
        onConfirm={() => {}}
        onUndo={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(confirm.textContent).toContain(
      "Finish or discard your change first.",
    );
    expect(confirm.textContent).not.toContain(CONFIRM_2);
  });

  it("opens from Version <n> ▾ in the live strip and goes back after the confirm", async () => {
    const requestRollback = vi.fn(() => Promise.resolve());
    const p = product();
    function Harness() {
      const versions = useVersionsPanel({
        product: p,
        productId: "product-1",
        drive: { header: { id: "drive-1" }, state: { global: { nodes: [] } } },
        now: NOW,
        requestRollback,
      });
      return (
        <>
          <StepStrip
            view={stripModel(p, {
              budget: null,
              averages: PHASE_AVERAGES,
              now: NOW,
            })}
            selected={null}
            onOpenStep={() => {}}
            onOpenSettings={() => {}}
            versions={{ live: 4, onOpen: versions.openPanel }}
          />
          {versions.element}
        </>
      );
    }
    const container = render(<Harness />);
    expect(container.querySelector('[aria-label="Versions"]')).toBeNull();
    click(button(container, "Version 4 ▾"));
    const dialog = container.querySelector<HTMLElement>(
      '[aria-label="Versions"]',
    );
    expect(dialog).not.toBeNull();
    click(button(rowOf(container, 2), "Go back"));
    expect(container.textContent).toContain(CONFIRM_2);
    // Cancel returns to the list; Escape closes it.
    click(button(container, "Cancel"));
    expect(container.querySelector('[aria-label="Versions"]')).not.toBeNull();
    click(button(rowOf(container, 2), "Go back"));
    click(
      Array.from(container.querySelectorAll("[data-confirm] button")).find(
        (b) => b.textContent === "Go back",
      ),
    );
    await settle();
    expect(requestRollback).toHaveBeenCalledWith(2);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    click(button(container, "Version 4 ▾"));
    pressKey(window, "Escape");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expectNoForbiddenWords(container);
  });
});
