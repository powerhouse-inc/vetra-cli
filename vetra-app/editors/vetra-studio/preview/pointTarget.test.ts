// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { describeElement, pointContextText } from "./pointTarget.js";
import type { PreviewScreen } from "./previewTabs.js";

const screen: PreviewScreen = {
  id: "doc-1",
  kind: "editor",
  name: "NotesEditor",
  documentTypes: ["powerhouse/notes"],
  confirmed: true,
};

const rect = (
  el: Element,
  r: { x: number; y: number; width: number; height: number },
) =>
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      ...r,
      top: r.y,
      left: r.x,
      right: r.x + r.width,
      bottom: r.y + r.height,
      toJSON: () => r,
    }),
  });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("describeElement", () => {
  it("reads component and field attributes from ancestors", () => {
    document.body.innerHTML =
      '<div data-vetra-component="Card"><span data-vetra-field="notes.title">' +
      '<button id="save" role="button" aria-label="Save note">Save</button>' +
      "</span></div>";
    const button = document.getElementById("save")!;
    rect(button, { x: 1, y: 2, width: 3, height: 4 });

    const target = describeElement(button, { screen });

    expect(target).toEqual({
      text: "Save",
      tag: "button",
      role: "button",
      label: "Save note",
      path: ["div.Card", "span", "button#save"],
      rect: { x: 1, y: 2, width: 3, height: 4 },
      component: "Card",
      field: "notes.title",
      module: "notes-editor",
      document: { type: "powerhouse/notes", id: "doc-1" },
    });
  });

  it("falls back to text and ancestor path without attributes", () => {
    document.body.innerHTML =
      "<section><div><p>Hello <b>world</b></p></div></section>";
    const p = document.querySelector("p")!;

    const target = describeElement(p, { screen: null });

    expect(target.text).toBe("Hello world");
    expect(target.path).toEqual(["section", "div", "p"]);
    expect(target.component).toBeNull();
    expect(target.field).toBeNull();
    expect(target.module).toBeNull();
    expect(target.document).toBeNull();
    expect(target.role).toBeNull();
    expect(target.label).toBeNull();
  });

  it("uses the component marker, then id, then first class in a path", () => {
    document.body.innerHTML =
      '<div id="root" class="card"><button id="b" class="primary x">Go</button></div>';

    const target = describeElement(document.getElementById("b")!, {
      screen: null,
    });

    expect(target.path).toEqual(["div#root", "button#b"]);
    expect(describeElement(document.body, { screen: null }).path).toEqual([]);
  });

  it("trims and caps the text at 200 characters", () => {
    const el = document.createElement("p");
    el.textContent = `  ${"x".repeat(250)}  \n`;
    document.body.appendChild(el);

    const { text } = describeElement(el, { screen: null });

    expect(text).toHaveLength(200);
    expect(text).toBe("x".repeat(200));
  });
});

describe("pointContextText", () => {
  it("has the exact four lines", () => {
    const text = pointContextText({
      text: "Save",
      tag: "button",
      role: "button",
      label: "Save note",
      path: ["div.Card", "button#save"],
      rect: { x: 10.4, y: 20.6, width: 30.2, height: 40.8 },
      component: "Card",
      field: "notes.title",
      module: "notes-editor",
      document: { type: "powerhouse/notes", id: "doc-1" },
    });

    expect(text).toBe(
      [
        '[Pointed at] button "Save"',
        "Component: Card · Field: notes.title",
        "Screen: notes-editor · Document: powerhouse/notes doc-1",
        "Where: div.Card › button#save · 30×41 at 10,21",
      ].join("\n"),
    );
  });

  it("writes unknown for what it does not know", () => {
    const text = pointContextText({
      text: "Hi",
      tag: "p",
      role: null,
      label: null,
      path: ["p"],
      rect: { x: 0, y: 0, width: 10, height: 20 },
      component: null,
      field: null,
      module: null,
      document: null,
    });

    expect(text.split("\n")).toEqual([
      '[Pointed at] p "Hi"',
      "Component: unknown · Field: unknown",
      "Screen: unknown · Document: unknown",
      "Where: p · 10×20 at 0,0",
    ]);
  });
});
