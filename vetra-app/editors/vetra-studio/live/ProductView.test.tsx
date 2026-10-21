// @vitest-environment happy-dom
import type { StudioProductState } from "document-models/studio-product";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failureFor, type Failure } from "../failures/failureStates.js";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import {
  at,
  buildingOps,
  productDoc,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";
import type { LiveEmbed } from "./LiveEmbed.js";
import { ProductView } from "./ProductView.js";

type LiveEmbedProps = Parameters<typeof LiveEmbed>[0];

const hoisted = vi.hoisted(() => ({ realEmbed: false }));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDocumentSafe: () => ({ status: "loading" }),
  usePHToast: () => () => {},
}));
vi.mock("../hooks/workshop-client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listImports: () => Promise.resolve([]),
}));

// The frame itself is the fallback test's subject; the other tests only need
// the live surface around it (and no network from a real frame).
vi.mock("./LiveEmbed.js", async (importOriginal) => {
  const actual = await importOriginal<{
    LiveEmbed: (props: LiveEmbedProps) => unknown;
  }>();
  return {
    LiveEmbed: (props: LiveEmbedProps) =>
      hoisted.realEmbed ? (
        actual.LiveEmbed(props)
      ) : (
        <div data-embed="live">Live app</div>
      ),
  };
});
// The preview pane has its own tests; here it stands for the live version's
// Studio preview (D12's fallback).
vi.mock("../preview/PreviewPane.js", () => ({
  PreviewPane: () => <div>Preview of the live version</div>,
}));

const STUDIO = "drive-1";
const LIVE_URL = "https://task-board.vetra.io";
const NOW = new Date(at(30));

function liveProduct(): StudioProductState {
  return readProduct(
    withLiveVersion(productDoc(...buildingOps()), { launchedAt: at(25) }).state
      .global,
  );
}

function view({
  product = liveProduct(),
  failure = null as Failure | null,
  onOpenAccess = () => {},
} = {}) {
  return render(
    <ProductView
      product={product}
      studioId={STUDIO}
      documents={[]}
      failure={failure}
      now={NOW}
      onOpenAccess={onOpenAccess}
    />,
  );
}

function writeClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

beforeEach(() => {
  window.localStorage.clear();
  hoisted.realEmbed = false;
});

describe("ProductView (state 2, spec §5.6)", () => {
  it("the live app fills the page", () => {
    const container = view();
    expect(
      container.querySelector("[data-embed]")?.getAttribute("data-embed"),
    ).toBe("live");
    // The arrival banner is there for this first visit.
    expect(container.querySelector('[data-banner="live"]')).not.toBeNull();
    expectNoForbiddenWords(container);
  });

  it("embed falls back to the version preview when framing is refused", () => {
    hoisted.realEmbed = true;
    const container = view();
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe(LIVE_URL);
    // The live app stays one click away while it is framed.
    expect(container.textContent).toContain("Open in new tab ↗");
    act(() => {
      frame!.dispatchEvent(new Event("error", { bubbles: true }));
    });
    expect(container.textContent).toContain(
      "Preview of Version 1 — open the live app ↗",
    );
    expect(container.textContent).toContain("Preview of the live version");
    // The live app stays one click away in both modes.
    expect(container.textContent).toContain("Open in new tab ↗");
    expect(container.querySelector("iframe")).toBeNull();
    expectNoForbiddenWords(container);
  });

  it("the arrival banner: address, Copy link and Change who can use it", async () => {
    const writeText = writeClipboard();
    const onOpenAccess = vi.fn();
    const container = view({ onOpenAccess });

    const banner = container.querySelector('[data-banner="live"]');
    expect(banner?.textContent).toContain("Your product is live.");
    expect(banner?.textContent).toContain("task-board.vetra.io ↗");
    expect(banner?.textContent).toContain(
      "Anyone with the link can sign in and use it.",
    );

    click(button(container, "Copy link"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(LIVE_URL);
    expect(button(container, "Copied")).toBeDefined();

    click(button(container, "Change who can use it"));
    expect(onOpenAccess).toHaveBeenCalledTimes(1);
    expectNoForbiddenWords(container);
  });

  it("a later visit shows only Went live <n> min ago", () => {
    // The first visit marks this Studio + version as seen.
    view();
    const later = view();
    expect(later.querySelector('[data-banner="live"]')).toBeNull();
    expect(later.textContent).toContain("Went live 5 min ago");
    expect(later.textContent).not.toContain("Your product is live.");
    expectNoForbiddenWords(later);
  });

  it("the live failure row sits over the app", () => {
    const product = liveProduct();
    product.health = "UNHEALTHY";
    const failure = failureFor(
      product,
      null,
      null,
      { studioRestarting: false },
      {
        now: NOW,
      },
    );
    const container = view({ product, failure });
    const row = container.querySelector('[data-failure="live-unhealthy"]');
    expect(row?.textContent).toContain(
      "Your live app isn't responding. We've been notified.",
    );
    expect(button(container, "Restart")).toBeDefined();
    expect(button(container, "Go back to Version 0")).toBeUndefined();
    expectNoForbiddenWords(container);
  });

  it("no main-path text contains a forbidden plumbing word", () => {
    writeClipboard();
    const container = view();
    expectNoForbiddenWords(container);
  });
});
