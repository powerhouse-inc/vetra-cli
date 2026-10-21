// @vitest-environment happy-dom
import { actions } from "document-models/studio-product";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render, typeInto } from "../test-utils/render.js";
import { at, drive } from "../test-utils/studioFixtures.js";
import { apply, liveDoc } from "./changeFixtures.js";
import { ChangeDrawer } from "./ChangeDrawer.js";
import { LiveSurface } from "./LiveSurface.js";

const hoisted = vi.hoisted(() => ({
  started: [] as unknown[],
  dispatched: [] as { action: unknown; id: string }[],
  failDispatch: false,
}));

vi.mock("./startChange.js", () => ({
  startChange: (input: unknown) => {
    hoisted.started.push(input);
    return Promise.resolve({ changeId: "c3", sessionId: "s-3", joined: false });
  },
}));
vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDocumentSafe: () => ({ status: "loading" }),
  dispatchActions: (action: unknown, id: string) => {
    if (hoisted.failDispatch) return Promise.reject(new Error("offline"));
    hoisted.dispatched.push({ action, id });
    return Promise.resolve(undefined);
  },
}));
vi.mock("../live/LiveEmbed.js", () => ({
  LiveEmbed: ({ liveUrl }: { liveUrl: string }) => (
    <div data-embed="live">Live app at {liveUrl}</div>
  ),
}));
vi.mock("../preview/PreviewPane.js", () => ({
  PreviewPane: () => <div>Preview of the live version</div>,
}));

const DRIVE = drive([]);
const NOW = new Date(at(45));

/** Version 1 live with three open ideas for it and one for a later version. */
function withSuggestions() {
  return readProduct(
    apply(
      liveDoc(),
      actions.setSuggestions({
        afterVersion: 1,
        items: [
          { id: "s1", text: "Let guests see their order status" },
          { id: "s2", text: "Add a daily summary for the kitchen" },
          { id: "s3", text: "Allow allergen notes" },
        ],
      }),
      actions.setSuggestions({
        afterVersion: 2,
        items: [
          { id: "n1", text: "Next time one" },
          { id: "n2", text: "Next time two" },
        ],
      }),
    ).state.global,
  );
}

function surface(product = withSuggestions()) {
  return (
    <LiveSurface
      product={product}
      productId="product-1"
      drive={DRIVE}
      documents={[]}
      failure={null}
      now={NOW}
      story={null}
      preview={null}
      requestedBy="Ada"
      onOpenAccess={() => {}}
    />
  );
}

function card(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-card="suggestions"]');
}

function input(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    'input[aria-label="What should change?"]',
  );
  if (!el) throw new Error("no change input");
  return el;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  hoisted.started = [];
  hoisted.dispatched = [];
  hoisted.failDispatch = false;
});

describe("Make it better (spec §5.8)", () => {
  it("the card offers the live version's ideas; picking one opens the drawer with it, editable", async () => {
    const container = render(surface());
    const c = card(container);
    expect(c?.textContent).toContain("Make it better");
    expect(
      [...(c?.querySelectorAll("[data-card-suggestion]") ?? [])].map(
        (b) => b.textContent,
      ),
    ).toEqual([
      "Let guests see their order status",
      "Add a daily summary for the kitchen",
      "Allow allergen notes",
    ]);
    expect(c?.textContent).not.toContain("Next time");
    expectNoForbiddenWords(container);

    click(container.querySelector('[data-card-suggestion="s2"]'));
    expect(container.querySelector('[data-drawer="change"]')).not.toBeNull();
    expect(input(container).value).toBe("Add a daily summary for the kitchen");
    expect(hoisted.started).toEqual([]);

    typeInto(input(container), "Add a daily summary for the kitchen at 9am");
    click(button(container, "Send"));
    await flush();
    expect(hoisted.started).toEqual([
      {
        drive: DRIVE,
        productId: "product-1",
        request: "Add a daily summary for the kitchen at 9am",
        kind: "CHANGE",
        suggestionId: "s2",
      },
    ]);
    expectNoForbiddenWords(container);
  });

  it("a chip in the drawer also starts the change from its suggestion; a typed request doesn't", async () => {
    const container = render(surface());
    click(button(container, "Change something"));
    // The card is away while the drawer (with its chips) is open.
    expect(card(container)).toBeNull();
    click(container.querySelector('[data-suggestion="s3"]'));
    click(button(container, "Send"));
    await flush();
    typeInto(input(container), "Make the header blue");
    click(button(container, "Send"));
    await flush();
    expect(hoisted.started).toEqual([
      expect.objectContaining({
        request: "Allow allergen notes",
        suggestionId: "s3",
      }),
      {
        drive: DRIVE,
        productId: "product-1",
        request: "Make the header blue",
        kind: "CHANGE",
      },
    ]);
  });

  it("× on the card or a chip dismisses that suggestion", async () => {
    const container = render(surface());
    click(container.querySelector('[data-card-dismiss="s1"]'));
    click(button(container, "Change something"));
    click(container.querySelector('[data-dismiss="s2"]'));
    await flush();
    expect(
      hoisted.dispatched.map(({ action, id }) => {
        const a = action as { type: string; input: unknown };
        return [a.type, a.input, id];
      }),
    ).toEqual([
      ["DISMISS_SUGGESTION", { id: "s1" }, "product-1"],
      ["DISMISS_SUGGESTION", { id: "s2" }, "product-1"],
    ]);
  });

  it("a dismiss that couldn't be sent says so plainly", async () => {
    hoisted.failDispatch = true;
    const container = render(surface());
    click(container.querySelector('[data-card-dismiss="s1"]'));
    await flush();
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't remove it. Try again.",
    );
  });

  it("shows once per launch: Not now puts it away for this version", () => {
    const first = render(surface());
    click(button(first, "Not now"));
    expect(card(first)).toBeNull();
    // A later visit to the same version: still away.
    expect(card(render(surface()))).toBeNull();
    // The next version brings it back with that version's ideas.
    const next = withSuggestions();
    next.liveVersion = 2;
    const later = render(surface(next));
    expect(card(later)?.textContent).toContain("Next time one");
  });

  it("no card without open ideas for the live version", () => {
    const product = withSuggestions();
    product.suggestions = product.suggestions.map((s) => ({
      ...s,
      status: s.afterVersion === 1 ? ("DISMISSED" as const) : s.status,
    }));
    expect(card(render(surface(product)))).toBeNull();
  });

  it("the drawer offers no × without a dismiss handler and keeps three chips at most", () => {
    const container = render(
      <ChangeDrawer
        product={withSuggestions()}
        story={null}
        launchedVersion={null}
        onStart={() => Promise.resolve()}
        onClose={() => {}}
      />,
    );
    expect(container.querySelectorAll("[data-suggestion]")).toHaveLength(3);
    expect(container.querySelector("[data-dismiss]")).toBeNull();
    // Emptying the box drops the suggestion it came from.
    click(container.querySelector('[data-suggestion="s1"]'));
    typeInto(input(container), "");
    expect(input(container).value).toBe("");
  });
});
