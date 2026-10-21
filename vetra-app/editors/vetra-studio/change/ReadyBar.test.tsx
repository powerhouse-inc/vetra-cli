// @vitest-environment happy-dom
import type { StudioProductState } from "document-models/studio-product";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render, rerender } from "../test-utils/render.js";
import { CHANGE_ID, changing } from "./changeFixtures.js";
import { ReadyBar } from "./ReadyBar.js";

type Dispatched = { action: { type: string; input: unknown }; id: string };

const hoisted = vi.hoisted(() => ({
  dispatched: [] as Dispatched[],
  refuse: false,
}));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatchActions: (
    action: Dispatched["action"],
    id: string,
    onErrors?: (errors: Error[]) => void,
  ) => {
    if (hoisted.refuse) onErrors?.([new Error("refused")]);
    else hoisted.dispatched.push({ action, id });
    return Promise.resolve(undefined);
  },
}));

function bar(product: StudioProductState = changing("READY")) {
  const change = product.changes.find((c) => c.id === CHANGE_ID)!;
  const onKeepChanging = vi.fn();
  const container = render(
    <ReadyBar
      product={product}
      productId="product-1"
      change={change}
      requestedBy="Ada"
      onKeepChanging={onKeepChanging}
    />,
  );
  return { container, onKeepChanging };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  hoisted.dispatched = [];
  hoisted.refuse = false;
});

describe("ReadyBar (spec §5.7)", () => {
  it("shows the change's title and the three choices", () => {
    const { container } = bar();
    const text = container.querySelector("[data-ready-bar]")?.textContent;
    expect(text).toContain("Ready to go live.");
    expect(text).toContain("“Notes for the kitchen”");
    expect(text).toContain("checks passed");
    expect(button(container, "Make it live")).toBeDefined();
    expect(button(container, "Keep changing")).toBeDefined();
    expect(button(container, "Discard")).toBeDefined();
    expectNoForbiddenWords(container);
  });

  it("is not shown while the change builds", () => {
    const { container } = bar(changing("BUILDING"));
    expect(container.querySelector("[data-ready-bar]")).toBeNull();
  });

  it("Make it live writes a launch request", async () => {
    const { container } = bar();
    click(button(container, "Make it live"));
    await flush();
    expect(hoisted.dispatched).toHaveLength(1);
    const [{ action, id }] = hoisted.dispatched;
    expect(id).toBe("product-1");
    expect(action.type).toBe("REQUEST_LAUNCH");
    expect(action.input).toMatchObject({
      changeId: CHANGE_ID,
      requestedBy: "Ada",
    });
  });

  it("a waiting launch request disables the choices", () => {
    const product = changing("READY");
    product.pendingRequest = {
      kind: "LAUNCH",
      changeId: CHANGE_ID,
      targetVersion: null,
      requestedAt: "2026-10-20T10:41:00.000Z",
      requestedBy: "Ada",
    };
    const { container } = bar(product);
    expect(container.textContent).toContain("Going live…");
    expect(button(container, "Make it live")?.disabled).toBe(true);
    expect(button(container, "Discard")?.disabled).toBe(true);
  });

  it("any waiting request blocks Make it live and Throw it away", () => {
    const product = changing("READY");
    const change = product.changes.find((c) => c.id === CHANGE_ID)!;
    const { container } = bar(product);
    click(button(container, "Discard"));
    expect(button(container, "Throw it away")?.disabled).toBe(false);

    // A restart request turns up while the confirm is open.
    product.pendingRequest = {
      kind: "RESTART",
      changeId: null,
      targetVersion: null,
      requestedAt: "2026-10-20T10:41:00.000Z",
      requestedBy: "Ada",
    };
    rerender(
      container,
      <ReadyBar
        product={product}
        productId="product-1"
        change={change}
        requestedBy="Ada"
        onKeepChanging={() => {}}
      />,
    );
    expect(button(container, "Make it live")?.disabled).toBe(true);
    expect(button(container, "Throw it away")?.disabled).toBe(true);
    click(button(container, "Throw it away"));
    expect(hoisted.dispatched).toEqual([]);
  });

  it("a refused request says so and the choices come back", async () => {
    hoisted.refuse = true;
    const { container } = bar();
    click(button(container, "Make it live"));
    await flush();
    // A plain line, not the refusal's own text.
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't make it live. Try again.",
    );
    expect(container.textContent).not.toContain("refused");
    expect(button(container, "Make it live")?.disabled).toBe(false);
  });

  it("Discard asks first and keeps the story", async () => {
    const { container } = bar();
    click(button(container, "Discard"));
    // Nothing is thrown away before the customer confirms.
    const confirm = container.querySelector('[role="alertdialog"]');
    expect(confirm?.textContent).toContain(
      "Throw away this change? Your live app isn't affected.",
    );
    expect(hoisted.dispatched).toEqual([]);
    expectNoForbiddenWords(container);

    click(button(container, "Keep it"));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(hoisted.dispatched).toEqual([]);

    click(button(container, "Discard"));
    click(button(container, "Throw it away"));
    await flush();
    // F9: a request for the agent, which resets the preview and marks the
    // change DISCARDED (the change itself is never deleted).
    expect(hoisted.dispatched.map((d) => d.action.type)).toEqual([
      "REQUEST_DISCARD",
    ]);
    expect(hoisted.dispatched[0].action.input).toMatchObject({
      changeId: CHANGE_ID,
      requestedBy: "Ada",
    });
  });

  it("Keep changing hands back to the conversation", () => {
    const { container, onKeepChanging } = bar();
    click(button(container, "Keep changing"));
    expect(onKeepChanging).toHaveBeenCalledTimes(1);
    expect(hoisted.dispatched).toEqual([]);
  });

  it("while it goes live, the launch lines of §5.5", () => {
    const product = changing("LAUNCHING");
    product.versions.push({
      ...product.versions[0],
      number: 2,
      changeId: CHANGE_ID,
      status: "LAUNCHING",
      launchedAt: null,
      lines: [
        { kind: "SNAPSHOT", status: "DONE", detail: "sha" },
        { kind: "PUBLISH", status: "RUNNING", detail: null },
        { kind: "DEPLOY", status: "WAITING", detail: null },
        { kind: "VERIFY", status: "WAITING", detail: null },
        { kind: "MIRROR", status: "SKIPPED", detail: null },
      ],
    });
    const { container } = bar(product);
    const lines = Array.from(
      container.querySelectorAll("[data-launch-line]"),
    ).map((l) => l.textContent);
    expect(lines).toEqual([
      "✓Saving version 2",
      "◐Publishing your product",
      "○Starting your live app at task-board.vetra.io",
      "○Checking it's up",
    ]);
    expectNoForbiddenWords(container);
  });
});
