// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  pressKey,
  render,
  rerender,
  typeInto,
} from "../test-utils/render.js";
import { CommandBar } from "./CommandBar.js";
import { DemoLayout } from "./DemoLayout.js";

const hoisted = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@powerhousedao/reactor-browser", () => ({
  usePHToast: () => hoisted.toast,
}));

function layout(over: Partial<Parameters<typeof DemoLayout>[0]> = {}) {
  return (
    <DemoLayout
      product={<div>Product</div>}
      name="Task board"
      live
      onOpenChat={() => {}}
      modeSwitch={<span>switch</span>}
      onSend={() => Promise.resolve()}
      lastReply={null}
      question={null}
      {...over}
    />
  );
}

function ctrlK() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>("input");
const enter = (c: HTMLElement) => pressKey(input(c)!, "Enter");

afterEach(() => vi.restoreAllMocks());

describe("command bar", () => {
  it("Ctrl-K opens the bar, plain K does not", () => {
    const c = render(layout());
    expect(input(c)).toBeNull();
    pressKey(window, "k");
    expect(input(c)).toBeNull();
    ctrlK();
    expect(input(c)?.placeholder).toBe("Ask for a change…");
    pressKey(input(c)!, "Escape");
    expect(input(c)).toBeNull();
  });

  it("⌘K opens it on a mac", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const c = render(layout());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(input(c)).not.toBeNull();
  });

  it("Enter sends the text and closes", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    const c = render(layout({ onSend }));
    ctrlK();
    typeInto(input(c), " make it blue ");
    enter(c);
    await act(async () => {});
    expect(onSend).toHaveBeenCalledWith("make it blue");
    expect(input(c)).toBeNull();
  });

  it("a failed send keeps the text and says so", async () => {
    const onSend = vi.fn(() => Promise.reject(new Error("Nope")));
    const c = render(layout({ onSend }));
    ctrlK();
    typeInto(input(c), "x");
    enter(c);
    await act(async () => {});
    expect(input(c)?.value).toBe("x");
    expect(c.querySelector("[role=alert]")?.textContent).toBe("Nope");
    expect(document.activeElement).toBe(input(c));
  });

  it("the newest reply shows as a toast, even with the bar closed", () => {
    hoisted.toast.mockClear();
    const props = {
      open: false,
      onClose: () => {},
      onSend: () => Promise.resolve(),
      pending: null,
    };
    const c = render(<CommandBar {...props} lastReply="Old" />);
    expect(hoisted.toast).not.toHaveBeenCalled();
    rerender(c, <CommandBar {...props} lastReply="Done: blue" />);
    expect(hoisted.toast).toHaveBeenCalledWith("Done: blue", { type: "info" });
  });

  it("the bar opens from the visible trigger", () => {
    const c = render(layout());
    click(button(c, "Ask for a change…"));
    expect(c.querySelector("[data-command-bar] input")).not.toBeNull();
    expect(button(c, "Ask for a change…")?.textContent).toContain("Ctrl K");
  });

  it("Ctrl-K inside a same-origin product frame opens the bar", () => {
    const frame = document.createElement("iframe");
    const c = render(layout({ product: <div data-slot /> }));
    c.querySelector("[data-demo-product]")!.appendChild(frame);
    // Attach on load, like the preview's frame navigating.
    act(() => {
      frame.dispatchEvent(new Event("load"));
    });
    const win = frame.contentWindow;
    expect(win).not.toBeNull();
    act(() => {
      win!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          cancelable: true,
        }),
      );
    });
    expect(input(c)).not.toBeNull();
  });

  it("Open chat goes to Review", () => {
    const onOpenChat = vi.fn();
    const c = render(layout({ onOpenChat }));
    click(button(c, "Open chat"));
    expect(onOpenChat).toHaveBeenCalled();
  });
});
