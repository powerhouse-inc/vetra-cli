// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { StoryPane } from "../story/StoryPane.js";
import { buildingProduct, chat, reply, user } from "../story/storyFixtures.js";
import { button, click, render } from "../test-utils/render.js";
import { PRODUCT_ID, SESSION_ID, at } from "../test-utils/studioFixtures.js";
import { ReviewLayout } from "./ReviewLayout.js";

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePHToast: () => undefined,
  dispatchActions: () => Promise.resolve(),
}));

function review(dock: "left" | "right" | "bottom" = "right") {
  const product = buildingProduct();
  const change = product.changes.find((c) => c.id === "c1");
  if (!change) throw new Error("no change");
  return render(
    <ReviewLayout
      dock={dock}
      size={38}
      onResize={() => {}}
      product={<div data-testid="product">Preview pane</div>}
      side={({ layer, onLayerChange }) => (
        <StoryPane
          product={product}
          change={change}
          chat={chat(
            user("u1", "a task board for my team", at(1)),
            reply("r1", "Should tasks have due dates?", at(7), at(7)),
          )}
          sessionId={SESSION_ID}
          productId={PRODUCT_ID}
          now={new Date(at(8))}
          layer={layer}
          onLayerChange={onLayerChange}
        />
      )}
    />,
  );
}

describe("ReviewLayout", () => {
  it("Review shows the product full height and the story in Outcome", () => {
    const container = review();
    const main = container.querySelector("main");
    const product = main?.querySelector("[data-review-product]");
    expect(product?.textContent).toContain("Preview pane");
    expect(product?.className).toContain("h-full");
    // The chat sits on the right of the product.
    const panes = Array.from(
      container.querySelector('[role="separator"]')?.parentElement?.children ??
        [],
    ).map((el) => el.tagName);
    expect(panes.slice(0, 3)).toEqual(["MAIN", "DIV", "ASIDE"]);
    const story = container.querySelector('aside[aria-label="Story"]');
    expect(
      story
        ?.querySelector("[data-story-layer]")
        ?.getAttribute("data-story-layer"),
    ).toBe("outcome");
    // The steer box and the agent's question stay in the story.
    expect(story?.querySelector('input[aria-label="Steer it"]')).not.toBeNull();
    expect(
      story?.querySelector('input[aria-label="Your answer"]'),
    ).not.toBeNull();
    expect(story?.textContent).toContain("Should tasks have due dates?");
  });

  it("Show activity switches the layer", () => {
    const container = review();
    const toggle = button(container, "Show activity");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    click(toggle);
    expect(
      container
        .querySelector("[data-story-layer]")
        ?.getAttribute("data-story-layer"),
    ).toBe("activity");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    click(toggle);
    expect(
      container
        .querySelector("[data-story-layer]")
        ?.getAttribute("data-story-layer"),
    ).toBe("outcome");
    // The story's own switch still reaches every layer.
    click(button(container, "Raw"));
    expect(
      container
        .querySelector("[data-story-layer]")
        ?.getAttribute("data-story-layer"),
    ).toBe("raw");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
  });

  it("docked at the bottom, the chat keeps a floor so the steer box never clips", () => {
    const container = review("bottom");
    const story = container.querySelector<HTMLElement>(
      'aside[aria-label="Story"]',
    );
    expect(story?.style.minHeight).toBe("240px");
    expect(story?.querySelector('input[aria-label="Steer it"]')).not.toBeNull();
  });

  it("a side panel sits next to the product", () => {
    const container = render(
      <ReviewLayout
        dock="right"
        size={38}
        onResize={() => {}}
        product={<div>Live app</div>}
        side={<div>Conversation</div>}
        panel={<div>Theme</div>}
      />,
    );
    expect(
      container.querySelector("main [data-review-panel]")?.textContent,
    ).toBe("Theme");
    // A plain side (no story yet) has no layer toggle.
    expect(button(container, "Show activity")).toBeUndefined();
    expect(container.querySelector("aside")?.textContent).toBe("Conversation");
  });
});
