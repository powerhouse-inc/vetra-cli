// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test-utils/render.js";
import {
  EMBED_TIMEOUT_MS,
  useEmbedFallback,
  type EmbedFallback,
} from "./useEmbedFallback.js";

const LIVE = "https://task-board.vetra.io";

/** Exposes the hook for the test, rendering what it decided. */
function Probe({
  handle,
  src = LIVE,
}: {
  handle: { current: EmbedFallback | null };
  src?: string | null;
}) {
  const embed = useEmbedFallback(src);
  handle.current = embed;
  return createElement("span", null, embed.failed ? "preview" : "live");
}

/** A frame on another origin: reading its location throws, as browsers do. */
function crossOriginFrame(): HTMLIFrameElement {
  const frame = {
    contentWindow: {
      get location(): never {
        throw new Error("Blocked a frame from accessing a cross-origin frame");
      },
    },
  };
  return frame as unknown as HTMLIFrameElement;
}

function setup(src: string | null = LIVE) {
  const handle: { current: EmbedFallback | null } = { current: null };
  const container = render(createElement(Probe, { handle, src }));
  return { handle, container };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEmbedFallback", () => {
  it("falls back when the frame hasn't loaded within 10 s", () => {
    const { container } = setup();
    expect(container.textContent).toBe("live");

    void act(() => vi.advanceTimersByTime(EMBED_TIMEOUT_MS - 1));
    expect(container.textContent).toBe("live");

    void act(() => vi.advanceTimersByTime(1));
    expect(container.textContent).toBe("preview");
  });

  it("a frame that loads in time stays; its timer is cleared", () => {
    const { handle, container } = setup();
    void act(() => handle.current?.onLoad(crossOriginFrame()));
    void act(() => vi.advanceTimersByTime(EMBED_TIMEOUT_MS * 2));
    expect(container.textContent).toBe("live");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a frame that reports an error switches at once", () => {
    const { handle, container } = setup();
    void act(() => handle.current?.onError());
    expect(container.textContent).toBe("preview");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a frame that loads on about:blank was refused (X-Frame-Options/CSP)", () => {
    const { handle, container } = setup();
    const blocked = document.createElement("iframe");
    document.body.appendChild(blocked);
    void act(() => handle.current?.onLoad(blocked));
    expect(container.textContent).toBe("preview");
    blocked.remove();
  });

  it("without an address nothing is armed", () => {
    const { container } = setup(null);
    expect(vi.getTimerCount()).toBe(0);
    void act(() => vi.advanceTimersByTime(EMBED_TIMEOUT_MS * 2));
    expect(container.textContent).toBe("live");
  });
});
