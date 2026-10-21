// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAYOUT_KEY,
  effectiveDock,
  effectiveMode,
  readLayout,
  writeLayout,
} from "./layoutPrefs.js";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("layoutPrefs", () => {
  it("defaults: build while building, review once live", () => {
    const prefs = readLayout("s1");
    expect(prefs).toEqual({
      mode: null,
      dock: "left",
      size: 38,
      dockSet: false,
    });
    expect(effectiveMode(prefs, { live: false })).toBe("build");
    expect(effectiveMode(prefs, { live: true })).toBe("review");
    expect(effectiveDock(prefs, "build")).toBe("left");
    expect(effectiveDock(prefs, "review")).toBe("right");
    expect(effectiveDock(prefs, "demo")).toBe("right");
  });

  it("remembers mode, dock and size per Studio", () => {
    writeLayout("a", { mode: "demo", dock: "bottom", size: 50, dockSet: true });
    writeLayout("b", { mode: "build", dock: "right", size: 30, dockSet: true });
    expect(LAYOUT_KEY("a")).toBe("vetra-studio:layout:a");
    expect(readLayout("a")).toEqual({
      mode: "demo",
      dock: "bottom",
      size: 50,
      dockSet: true,
    });
    expect(readLayout("b").dock).toBe("right");
    const a = readLayout("a");
    expect(effectiveMode(a, { live: false })).toBe("demo");
    expect(effectiveDock(a, "build")).toBe("bottom");
    expect(readLayout("c").mode).toBeNull();
  });

  it("legacy story width becomes the size", () => {
    window.localStorage.setItem("vetra-studio:story-width", "45");
    expect(readLayout("s1").size).toBe(45);
    window.localStorage.setItem("vetra-studio:story-width", "99");
    expect(readLayout("s1").size).toBe(70);
    writeLayout("s1", { mode: null, dock: "left", size: 25, dockSet: false });
    expect(readLayout("s1").size).toBe(25);
  });

  it("garbage and out-of-range values fall back", () => {
    window.localStorage.setItem(LAYOUT_KEY("g"), "{not json");
    expect(readLayout("g")).toEqual({
      mode: null,
      dock: "left",
      size: 38,
      dockSet: false,
    });
    window.localStorage.setItem(LAYOUT_KEY("g"), "42");
    expect(readLayout("g").size).toBe(38);
    window.localStorage.setItem(
      LAYOUT_KEY("g"),
      JSON.stringify({ mode: "wild", dock: "top", size: 5, dockSet: "yes" }),
    );
    expect(readLayout("g")).toEqual({
      mode: null,
      dock: "left",
      size: 20,
      dockSet: false,
    });
    window.localStorage.setItem(
      LAYOUT_KEY("g"),
      JSON.stringify({
        mode: "review",
        dock: "right",
        size: 500,
        dockSet: true,
      }),
    );
    expect(readLayout("g").size).toBe(70);
    window.localStorage.setItem(
      LAYOUT_KEY("g"),
      JSON.stringify({ size: "wide", dock: "bottom" }),
    );
    const p = readLayout("g");
    expect(p.size).toBe(38);
    expect(p.dockSet).toBe(false);
    expect(effectiveDock(p, "review")).toBe("right");
  });

  it("blocked storage still yields defaults", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLayout("s1")).toEqual({
      mode: null,
      dock: "left",
      size: 38,
      dockSet: false,
    });
    expect(() =>
      writeLayout("s1", {
        mode: "demo",
        dock: "left",
        size: 40,
        dockSet: true,
      }),
    ).not.toThrow();
  });
});
