// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { COMMAND_INPUT_ATTR, isCommandShortcut } from "./commandKeys.js";

function key(init: KeyboardEventInit, target?: Element): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, ...init });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
}

describe("isCommandShortcut", () => {
  it("is Ctrl-K off mac and ⌘K on mac, never plain K", () => {
    expect(isCommandShortcut(key({ key: "k", ctrlKey: true }), "Linux")).toBe(
      true,
    );
    expect(isCommandShortcut(key({ key: "k", metaKey: true }), "Linux")).toBe(
      false,
    );
    expect(
      isCommandShortcut(key({ key: "k", metaKey: true }), "MacIntel"),
    ).toBe(true);
    expect(
      isCommandShortcut(key({ key: "k", ctrlKey: true }), "MacIntel"),
    ).toBe(false);
    expect(isCommandShortcut(key({ key: "k" }), "Linux")).toBe(false);
    expect(isCommandShortcut(key({ key: "j", ctrlKey: true }), "Linux")).toBe(
      false,
    );
  });

  it("ignores the page's own inputs, except the bar's", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const own = document.createElement("input");
    own.setAttribute(COMMAND_INPUT_ATTR, "");
    const init = { key: "k", ctrlKey: true };
    expect(isCommandShortcut(key(init, input), "Linux")).toBe(false);
    expect(isCommandShortcut(key(init, area), "Linux")).toBe(false);
    expect(isCommandShortcut(key(init, own), "Linux")).toBe(true);
    expect(
      isCommandShortcut(key(init, document.createElement("div")), "Linux"),
    ).toBe(true);
  });
});
