// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPointLayer } from "./pointLayer.js";

const frames: HTMLIFrameElement[] = [];
afterEach(() => frames.splice(0).forEach((f) => f.remove()));

function makeFrame(html = '<button id="b">Go</button><p id="p">Hi</p>') {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  frames.push(frame);
  frame.contentDocument!.body.innerHTML = html;
  return frame;
}

const handlers = () => ({
  onSelect: vi.fn(),
  onEditText: vi.fn(),
  onExit: vi.fn(),
});

const overlay = (f: HTMLIFrameElement) =>
  f.contentDocument!.querySelector<HTMLElement>("[data-vetra-point-overlay]");

function fire(el: Element, type: string, init: object = {}) {
  const win = el.ownerDocument.defaultView!;
  const Ctor = type.startsWith("key") ? win.KeyboardEvent : win.MouseEvent;
  const ev = new Ctor(type, { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
}

describe("attachPointLayer", () => {
  it("hover moves the outline over the element", () => {
    const frame = makeFrame();
    const target = frame.contentDocument!.getElementById("b")!;
    target.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 30, height: 40 }) as DOMRect;
    const detach = attachPointLayer(frame, handlers());
    fire(target, "mousemove");
    const o = overlay(frame)!;
    expect(o.style.pointerEvents).toBe("none");
    expect(o.style.position).toBe("absolute");
    expect(o.style.width).toBe("30px");
    expect(o.style.height).toBe("40px");
    expect(o.style.display).not.toBe("none");
    detach();
  });

  it("click selects without reaching the product handler", () => {
    const frame = makeFrame();
    const target = frame.contentDocument!.getElementById("b")!;
    const product = vi.fn();
    target.addEventListener("click", product);
    const h = handlers();
    const detach = attachPointLayer(frame, h);
    const ev = fire(target, "click");
    expect(h.onSelect).toHaveBeenCalledWith(target);
    expect(product).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    fire(target, "dblclick");
    expect(h.onEditText).toHaveBeenCalledWith(target);
    expect(product).not.toHaveBeenCalled();
    detach();
  });

  it("detach removes every listener and overlay; product click handler fires again", () => {
    const frame = makeFrame();
    const target = frame.contentDocument!.getElementById("b")!;
    const product = vi.fn();
    target.addEventListener("click", product);
    const h = handlers();
    const detach = attachPointLayer(frame, h);
    fire(target, "mousemove");
    detach();
    expect(overlay(frame)).toBeNull();
    const ev = fire(target, "click");
    fire(target, "dblclick");
    fire(frame.contentDocument!.body, "keydown", { key: "Escape" });
    expect(product).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onEditText).not.toHaveBeenCalled();
    expect(h.onExit).not.toHaveBeenCalled();
    detach(); // idempotent
  });

  it("Esc exits", () => {
    const frame = makeFrame();
    const h = handlers();
    const detach = attachPointLayer(frame, h);
    fire(frame.contentDocument!.body, "keydown", { key: "Escape" });
    expect(h.onExit).toHaveBeenCalledTimes(1);
    detach();
  });

  it("frame navigation re-attaches", () => {
    const frame = makeFrame();
    const h = handlers();
    const detach = attachPointLayer(frame, h);
    // Simulate a navigation: the document body is replaced, then load fires.
    frame.contentDocument!.body.innerHTML = '<a id="n">Next</a>';
    expect(overlay(frame)).toBeNull();
    frame.dispatchEvent(new Event("load"));
    expect(overlay(frame)).not.toBeNull();
    const n = frame.contentDocument!.getElementById("n")!;
    fire(n, "click");
    expect(h.onSelect).toHaveBeenCalledWith(n);
    detach();
    expect(overlay(frame)).toBeNull();
    frame.dispatchEvent(new Event("load"));
    expect(overlay(frame)).toBeNull();
  });

  it("cross-origin frame is a no-op", () => {
    const frame = makeFrame();
    Object.defineProperty(frame, "contentDocument", { get: () => null });
    const h = handlers();
    const detach = attachPointLayer(frame, h);
    expect(h.onExit).toHaveBeenCalledTimes(1);
    expect(() => detach()).not.toThrow();
  });
});
