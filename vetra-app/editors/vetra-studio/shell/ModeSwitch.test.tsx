// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { button, click, render } from "../test-utils/render.js";
import { LAYOUT_KEY } from "./layoutPrefs.js";
import { ModeSwitch } from "./ModeSwitch.js";
import { useLayout } from "./useLayout.js";

function Harness({
  studioId = "studio-1",
  live = false,
  attention = 0,
}: {
  studioId?: string;
  live?: boolean;
  attention?: number;
}) {
  const layout = useLayout(studioId, live);
  return (
    <div data-mode={layout.mode} data-dock={layout.dock}>
      <ModeSwitch
        mode={layout.mode}
        onMode={layout.setMode}
        dock={layout.dock}
        onDock={layout.setDock}
        attention={attention}
      />
    </div>
  );
}

function pressed(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('button[aria-pressed="true"]'),
  ).map((b) => b.textContent.trim());
}

function chooseDock(container: HTMLElement, label: string): void {
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Chat position"]',
  );
  if (!select) throw new Error("no dock menu");
  const option = Array.from(select.options).find((o) => o.text === label);
  if (!option) throw new Error(`no option ${label}`);
  act(() => {
    Reflect.set(HTMLSelectElement.prototype, "value", option.value, select);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ModeSwitch", () => {
  it("one click switches Build → Review → Demo", () => {
    const container = render(<Harness />);
    const root = container.firstElementChild;
    expect(pressed(container)).toEqual(["Build"]);
    expect(root?.getAttribute("data-dock")).toBe("left");

    click(button(container, "Review"));
    expect(pressed(container)).toEqual(["Review"]);
    expect(root?.getAttribute("data-mode")).toBe("review");
    expect(root?.getAttribute("data-dock")).toBe("right");

    click(button(container, "Demo"));
    expect(pressed(container)).toEqual(["Demo"]);
    expect(root?.getAttribute("data-mode")).toBe("demo");
    // Demo has no chat to place.
    expect(
      container.querySelector('select[aria-label="Chat position"]'),
    ).toBeNull();

    click(button(container, "Build"));
    expect(pressed(container)).toEqual(["Build"]);
  });

  it("the dock menu offers left, right and bottom", () => {
    const container = render(<Harness />);
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Chat position"]',
    );
    expect(Array.from(select?.options ?? []).map((o) => o.text)).toEqual([
      "Chat on the left",
      "Chat on the right",
      "Chat on the bottom",
    ]);
    chooseDock(container, "Chat on the bottom");
    expect(container.firstElementChild?.getAttribute("data-dock")).toBe(
      "bottom",
    );
    // A picked side holds in every mode.
    click(button(container, "Review"));
    expect(container.firstElementChild?.getAttribute("data-dock")).toBe(
      "bottom",
    );
  });

  it("mode is remembered after remount", () => {
    const first = render(<Harness />);
    click(button(first, "Review"));
    chooseDock(first, "Chat on the left");

    const again = render(<Harness />);
    expect(pressed(again)).toEqual(["Review"]);
    expect(again.firstElementChild?.getAttribute("data-dock")).toBe("left");
    // Per Studio: another Studio keeps its own default.
    const other = render(<Harness studioId="studio-2" />);
    expect(pressed(other)).toEqual(["Build"]);
    expect(window.localStorage.getItem(LAYOUT_KEY("studio-1"))).toContain(
      '"review"',
    );
  });

  it("defaults to Review once live", () => {
    const container = render(<Harness live />);
    expect(pressed(container)).toEqual(["Review"]);
    expect(container.firstElementChild?.getAttribute("data-dock")).toBe(
      "right",
    );
  });

  it("works when storage is blocked", () => {
    const original = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error("blocked");
    };
    try {
      const container = render(<Harness />);
      click(button(container, "Review"));
      expect(pressed(container)).toEqual(["Review"]);
    } finally {
      window.localStorage.setItem = original;
    }
  });

  it("shows how many things wait for you", () => {
    expect(render(<Harness />).querySelector("[data-attention]")).toBeNull();
    const container = render(<Harness attention={2} />);
    expect(container.querySelector("[data-attention]")?.textContent).toBe("2");
  });
});
