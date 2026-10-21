// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { at } from "../test-utils/studioFixtures.js";
import { awaySummary, readLastVisit, writeLastVisit } from "./awayCard.js";
import { buildingProduct } from "./storyFixtures.js";

const ms = (m: number) => Date.parse(at(m));

describe("awaySummary", () => {
  it("lists the outcomes after the last visit only", () => {
    const out = awaySummary(buildingProduct(), ms(4));
    expect(out?.outcomes.map((o) => o.id)).toEqual(["m2"]);
    expect(out?.waiting).toEqual([]);
  });

  it("is null when nothing changed and nothing waits", () => {
    expect(awaySummary(buildingProduct(), ms(30))).toBeNull();
  });

  it("lists a ready change and an open question as waiting", () => {
    const product = buildingProduct();
    const ready = {
      ...product,
      changes: product.changes.map((c) => ({ ...c, status: "READY" as const })),
    };
    const out = awaySummary(ready, ms(30), "Which colour?");
    expect(out?.waiting).toEqual([
      "Which colour?",
      "Your change is ready to go live.",
    ]);
  });
});

describe("waiting scope", () => {
  it("a stopped step in a closed change is not waiting", () => {
    const product = buildingProduct();
    const closed = {
      ...product,
      changes: product.changes.map((c) => ({
        ...c,
        status: "CLOSED" as const,
        steps: c.steps.map((s) => ({
          ...s,
          status: "STOPPED" as const,
          reason: "Old trouble",
        })),
      })),
    };
    expect(awaySummary(closed, ms(30))).toBeNull();
  });
});

describe("last visit storage", () => {
  it("treats an empty stored value as no visit", () => {
    window.localStorage.setItem("vetra-studio:last-visit:e", "");
    expect(readLastVisit("e")).toBeNull();
  });

  it("round-trips and tolerates blocked storage", () => {
    expect(readLastVisit("s1")).toBeNull();
    writeLastVisit("s1", 42);
    expect(readLastVisit("s1")).toBe(42);
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
      configurable: true,
    });
    try {
      expect(readLastVisit("s1")).toBeNull();
      expect(() => writeLastVisit("s1", 1)).not.toThrow();
    } finally {
      if (real) Object.defineProperty(window, "localStorage", real);
    }
  });
});
