// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { pressKey, render } from "../test-utils/render.js";
import { DockSplit } from "./DockSplit.js";

function mount(
  dock: "left" | "right" | "bottom",
  onResize = vi.fn(),
  size = 38,
) {
  const container = render(
    <DockSplit
      dock={dock}
      size={size}
      onResize={onResize}
      sideLabel="Story"
      side={<p>side</p>}
      main={<p>main</p>}
    />,
  );
  const root = container.firstElementChild as HTMLElement;
  root.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
    }) as DOMRect;
  const sep = container.querySelector('[role="separator"]') as HTMLElement;
  return { container, root, sep, onResize };
}

function mouse(
  type: string,
  x: number,
  y: number,
  target: EventTarget = window,
) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("DockSplit", () => {
  it("docks left, right and bottom", () => {
    const left = mount("left");
    expect(left.root.children[0].getAttribute("aria-label")).toBe("Story");
    expect(left.root.className).toContain("flex-row");
    expect(left.sep.getAttribute("aria-orientation")).toBe("vertical");

    const right = mount("right");
    expect(right.root.lastElementChild?.getAttribute("aria-label")).toBe(
      "Story",
    );
    expect(right.root.className).toContain("flex-row");

    const bottom = mount("bottom");
    expect(bottom.root.className).toContain("flex-col");
    expect(bottom.root.lastElementChild?.getAttribute("aria-label")).toBe(
      "Story",
    );
    expect(bottom.sep.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("drag reports one size at the end", () => {
    const { sep, onResize } = mount("left");
    mouse("mousedown", 380, 0, sep);
    mouse("mousemove", 400, 0);
    mouse("mousemove", 500, 0);
    expect(onResize).not.toHaveBeenCalled();
    mouse("mouseup", 500, 0);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(50);
  });

  it("drag measures from the right and the bottom edge", () => {
    const right = mount("right");
    mouse("mousedown", 0, 0, right.sep);
    mouse("mousemove", 700, 0);
    mouse("mouseup", 700, 0);
    expect(right.onResize).toHaveBeenCalledWith(30);

    const bottom = mount("bottom");
    mouse("mousedown", 0, 0, bottom.sep);
    mouse("mousemove", 0, 300);
    mouse("mouseup", 0, 300);
    expect(bottom.onResize).toHaveBeenCalledWith(40);
  });

  it("keyboard resizes", () => {
    const l = mount("left");
    pressKey(l.sep, "ArrowRight");
    expect(l.onResize).toHaveBeenLastCalledWith(40);
    pressKey(l.sep, "ArrowLeft");
    expect(l.onResize).toHaveBeenLastCalledWith(36);

    const r = mount("right");
    pressKey(r.sep, "ArrowLeft");
    expect(r.onResize).toHaveBeenLastCalledWith(40);

    const b = mount("bottom");
    pressKey(b.sep, "ArrowUp");
    expect(b.onResize).toHaveBeenLastCalledWith(40);
    pressKey(b.sep, "ArrowDown");
    expect(b.onResize).toHaveBeenLastCalledWith(36);
  });

  it("double-click resets", () => {
    const { sep, onResize } = mount("left", vi.fn(), 55);
    act(() => {
      sep.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onResize).toHaveBeenCalledWith(38);
  });
});
