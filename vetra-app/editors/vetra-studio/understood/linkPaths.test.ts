import { describe, expect, it } from "vitest";
import { labelWidth, linkPaths, type Rect } from "./linkPaths.js";

const rect = (left: number, top: number): Rect => ({
  left,
  top,
  width: 200,
  height: 300,
});

describe("linkPaths", () => {
  it("joins cards in the same row with an arc over their tops", () => {
    const rects = new Map([
      ["a", rect(0, 50)],
      ["b", rect(300, 52)],
    ]);
    const [p] = linkPaths([{ from: "a", to: "b", label: "liegt auf" }], rects);
    expect(p.d).toMatch(/^M 100 50 C /);
    expect(p.d).toMatch(/400 48$/);
    expect(p.labelX).toBe(250);
    expect(p.labelY).toBeLessThan(50);
    expect(p.label).toBe("liegt auf");
  });

  it("joins cards in different rows with a straight line, either way", () => {
    const rects = new Map([
      ["up", rect(0, 0)],
      ["down", rect(300, 400)],
    ]);
    const [down] = linkPaths([{ from: "up", to: "down", label: "" }], rects);
    expect(down.d).toBe("M 100 300 L 400 398");
    const [up] = linkPaths([{ from: "down", to: "up", label: "" }], rects);
    expect(up.d).toBe("M 400 400 L 100 302");
    expect(up.labelX).toBe(250);
    expect(up.labelY).toBe(350);
  });

  it("skips self-links and cards that were not measured", () => {
    const rects = new Map([["a", rect(0, 0)]]);
    expect(
      linkPaths(
        [
          { from: "a", to: "a", label: "" },
          { from: "a", to: "missing", label: "" },
        ],
        rects,
      ),
    ).toEqual([]);
  });

  it("two links on one card start at different points", () => {
    const rects = new Map([
      ["a", rect(0, 0)],
      ["b", rect(300, 0)],
      ["c", rect(600, 0)],
    ]);
    const paths = linkPaths(
      [
        { from: "a", to: "b", label: "" },
        { from: "a", to: "c", label: "" },
      ],
      rects,
    );
    const startX = paths.map((p) => Number(/^M (\S+)/.exec(p.d)?.[1]));
    expect(startX[0]).not.toBe(startX[1]);
    expect(new Set(paths.map((p) => p.key)).size).toBe(2);
  });

  it("a longer label gets a wider pill", () => {
    expect(labelWidth("zugewiesen an")).toBeGreaterThan(labelWidth("auf"));
  });
});
