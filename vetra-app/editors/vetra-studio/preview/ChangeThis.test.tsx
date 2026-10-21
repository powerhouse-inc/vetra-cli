// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { button, click, render } from "../test-utils/render.js";
import {
  CHANGE_THIS,
  ChangeThis,
  SHOT_ATTACHED,
  WHAT_SHOULD_CHANGE,
} from "./ChangeThis.js";
import type { PointTarget } from "./pointTarget.js";

const target: PointTarget = {
  text: "Save",
  tag: "button",
  role: null,
  label: null,
  path: ["button#save"],
  rect: { x: 10, y: 20, width: 30, height: 40 },
  component: "Card",
  field: null,
  module: null,
  document: null,
};

function typeTextarea(el: HTMLTextAreaElement, value: string) {
  act(() => {
    Reflect.set(HTMLTextAreaElement.prototype, "value", value, el);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const textarea = (container: HTMLElement) =>
  container.querySelector<HTMLTextAreaElement>("textarea")!;

describe("ChangeThis", () => {
  it("shows the element text and the request box", () => {
    const container = render(
      <ChangeThis
        target={target}
        shot={null}
        onSend={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    expect(
      container.querySelector('[role="dialog"]')!.getAttribute("aria-label"),
    ).toBe(CHANGE_THIS);
    expect(container.textContent).toContain(CHANGE_THIS);
    expect(container.textContent).toContain("Save");
    expect(textarea(container).placeholder).toBe(WHAT_SHOULD_CHANGE);
    expect(container.textContent).not.toContain(SHOT_ATTACHED);
  });

  it("Send hands the typed request to the caller", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    const container = render(
      <ChangeThis
        target={target}
        shot={new Blob(["png"], { type: "image/png" })}
        onSend={onSend}
        onCancel={() => {}}
      />,
    );
    typeTextarea(textarea(container), "Make this bold");

    click(button(container, "Send"));

    await vi.waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("Make this bold"),
    );
    expect(container.textContent).toContain(SHOT_ATTACHED);
  });

  it("Cancel sends nothing", () => {
    const onSend = vi.fn(() => Promise.resolve());
    const onCancel = vi.fn();
    const container = render(
      <ChangeThis
        target={target}
        shot={null}
        onSend={onSend}
        onCancel={onCancel}
      />,
    );

    click(button(container, "Cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a failed send and stays open", async () => {
    const onSend = vi.fn(() => Promise.reject(new Error("Couldn't send.")));
    const container = render(
      <ChangeThis
        target={target}
        shot={null}
        onSend={onSend}
        onCancel={() => {}}
      />,
    );
    typeTextarea(textarea(container), "Make this bold");

    click(button(container, "Send"));

    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "Couldn't send.",
      ),
    );
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
