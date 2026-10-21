// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ toBlob: vi.fn() }));
vi.mock("html-to-image", () => ({ toBlob: hoisted.toBlob }));

import { pointShot, shotElement } from "./pointShot.js";

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
  document.body.innerHTML = "";
});

function makeFrame(html: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  frames.push(frame);
  frame.contentDocument!.body.innerHTML = html;
  return frame;
}

function setRect(
  el: Element,
  r: { x?: number; y?: number; width: number; height: number },
) {
  const x = r.x ?? 0;
  const y = r.y ?? 0;
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      x,
      y,
      width: r.width,
      height: r.height,
      top: y,
      left: x,
      right: x + r.width,
      bottom: y + r.height,
      toJSON: () => ({}),
    }),
  });
}

beforeEach(() => {
  hoisted.toBlob.mockReset();
  hoisted.toBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
});

describe("pointShot", () => {
  it("returns null when rendering fails", async () => {
    const frame = makeFrame('<button id="b">Go</button>');
    const el = frame.contentDocument!.getElementById("b")!;
    setRect(el, { width: 200, height: 100 });
    hoisted.toBlob.mockRejectedValueOnce(new Error("boom"));

    await expect(pointShot(frame, el)).resolves.toBeNull();
  });

  it("renders the nearest ancestor at least 120×80, capped at 1200 wide", async () => {
    const frame = makeFrame('<div id="big"><button id="b">Go</button></div>');
    const doc = frame.contentDocument!;
    const big = doc.getElementById("big")!;
    const button = doc.getElementById("b")!;
    setRect(big, { width: 3000, height: 500 });
    setRect(button, { width: 30, height: 20 });

    const shot = await pointShot(frame, button);

    expect(shot).not.toBeNull();
    expect(hoisted.toBlob).toHaveBeenCalledWith(
      big,
      expect.objectContaining({ canvasWidth: 1200, canvasHeight: 200 }),
    );
  });

  it("uses the element itself when no ancestor is large enough", () => {
    const frame = makeFrame('<div id="small"><span id="s">Go</span></div>');
    const doc = frame.contentDocument!;
    setRect(doc.getElementById("small")!, { width: 90, height: 60 });
    const span = doc.getElementById("s")!;
    setRect(span, { width: 40, height: 20 });

    expect(shotElement(span)).toBe(span);
  });

  it("is null for a frame the element is not in", async () => {
    const frame = makeFrame("");
    Object.defineProperty(frame, "contentDocument", { get: () => null });
    const el = document.createElement("p");

    await expect(pointShot(frame, el)).resolves.toBeNull();
    expect(hoisted.toBlob).not.toHaveBeenCalled();
  });
});
