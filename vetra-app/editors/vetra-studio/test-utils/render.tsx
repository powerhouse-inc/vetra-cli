/**
 * Minimal DOM rendering for component tests (run them with
 * `// @vitest-environment happy-dom`): mounts into a fresh container and
 * unmounts after each test.
 */
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

export function render(element: ReactElement): HTMLElement {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  mounted.push({ root, container });
  return container;
}

/** Re-renders a container from `render` (state that changed underneath it). */
export function rerender(container: HTMLElement, element: ReactElement): void {
  const entry = mounted.find((m) => m.container === container);
  if (!entry) throw new Error("container was not rendered");
  act(() => entry.root.render(element));
}

export function click(element: Element | null | undefined): void {
  if (!element) throw new Error("nothing to click");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** The first button whose text (or aria-label) contains `text`. */
export function button(
  container: HTMLElement,
  text: string,
): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (b) =>
      b.textContent.includes(text) ||
      (b.getAttribute("aria-label") ?? "").includes(text),
  );
}

/** Types `value` into an input the way React sees it. */
export function typeInto(
  input: Element | null | undefined,
  value: string,
): void {
  if (!(input instanceof HTMLInputElement)) throw new Error("not an input");
  act(() => {
    // The prototype setter, so React notices the change.
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function pressKey(target: Element | Window, key: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}
