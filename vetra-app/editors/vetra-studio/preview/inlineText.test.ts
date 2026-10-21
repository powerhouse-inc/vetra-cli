// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { startInlineEdit } from "./inlineText.js";

const key = (el: Element, name: string) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
    }),
  );

describe("startInlineEdit", () => {
  it("edits a text-only element and restores it on Esc", () => {
    document.body.innerHTML = "<p>Save</p>";
    const el = document.querySelector("p")!;
    const onDone = vi.fn();

    expect(startInlineEdit(el, onDone)).toBe(true);
    expect(el.getAttribute("contenteditable")).toBe("plaintext-only");
    el.textContent = "Discard";
    key(el, "Escape");

    expect(onDone).toHaveBeenCalledWith(null);
    expect(el.getAttribute("contenteditable")).toBeNull();
    expect(el.textContent).toBe("Save");
  });

  it("Enter commits the new text and restores the attribute", () => {
    document.body.innerHTML = '<p contenteditable="true">Save</p>';
    const el = document.querySelector("p")!;
    const onDone = vi.fn();

    expect(startInlineEdit(el, onDone)).toBe(true);
    el.textContent = "Send";
    key(el, "Enter");

    expect(onDone).toHaveBeenCalledWith("Send");
    expect(el.getAttribute("contenteditable")).toBe("true");
    expect(el.textContent).toBe("Save");
  });

  it("blur cancels", () => {
    document.body.innerHTML = "<p>Save</p>";
    const el = document.querySelector("p")!;
    const onDone = vi.fn();

    startInlineEdit(el, onDone);
    el.textContent = "Send";
    el.dispatchEvent(new Event("blur"));

    expect(onDone).toHaveBeenCalledWith(null);
    expect(el.textContent).toBe("Save");
  });

  it("non-text elements are not editable", () => {
    document.body.innerHTML = "<p><strong>Save</strong></p>";
    const el = document.querySelector("p")!;

    expect(startInlineEdit(el, vi.fn())).toBe(false);
    expect(el.getAttribute("contenteditable")).toBeNull();
  });

  it("ignores a second finish after the first", () => {
    document.body.innerHTML = "<p>Save</p>";
    const el = document.querySelector("p")!;
    const onDone = vi.fn();

    startInlineEdit(el, onDone);
    key(el, "Escape");
    key(el, "Enter");

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
