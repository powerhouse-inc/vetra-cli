// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { button, click, render } from "../test-utils/render.js";
import { at } from "../test-utils/studioFixtures.js";
import { AwayCard } from "./AwayCard.js";
import { LAST_VISIT_KEY } from "./awayCard.js";
import { buildingProduct } from "./storyFixtures.js";

const ms = (m: number) => Date.parse(at(m));
const key = LAST_VISIT_KEY("s1");

beforeEach(() => window.localStorage.clear());

describe("AwayCard", () => {
  it("no card on the first ever visit", () => {
    const el = render(<AwayCard studioId="s1" product={buildingProduct()} />);
    expect(el.textContent).toBe("");
  });

  it("stores now on pagehide, never on first render", () => {
    const el = render(<AwayCard studioId="s1" product={buildingProduct()} />);
    expect(window.localStorage.getItem(key)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(el.textContent).toBe("");
  });

  it("lists outcomes since the last visit", () => {
    window.localStorage.setItem(key, String(ms(4)));
    const el = render(<AwayCard studioId="s1" product={buildingProduct()} />);
    expect(el.textContent).toContain("While you were away");
    expect(el.textContent).toContain("retried once on a backup model");
    expect(el.textContent).not.toContain("Planned 1 app");
  });

  it("lists a ready change as waiting for you", () => {
    window.localStorage.setItem(key, String(ms(30)));
    const p = buildingProduct();
    const ready = {
      ...p,
      changes: p.changes.map((c) => ({ ...c, status: "READY" as const })),
    };
    const el = render(<AwayCard studioId="s1" product={ready} />);
    expect(el.textContent).toContain("Your change is ready to go live.");
  });

  it("Got it hides it and stores the time", () => {
    window.localStorage.setItem(key, String(ms(4)));
    const el = render(<AwayCard studioId="s1" product={buildingProduct()} />);
    click(button(el, "Got it"));
    expect(el.textContent).toBe("");
    expect(Number(window.localStorage.getItem(key))).toBeGreaterThan(ms(4));
  });

  it("blocked storage renders nothing and does not throw", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
      configurable: true,
    });
    try {
      const el = render(<AwayCard studioId="s1" product={buildingProduct()} />);
      expect(el.textContent).toBe("");
    } finally {
      if (real) Object.defineProperty(window, "localStorage", real);
    }
  });
});
