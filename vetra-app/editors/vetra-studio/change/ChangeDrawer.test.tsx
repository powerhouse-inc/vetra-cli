// @vitest-environment happy-dom
import { actions } from "document-models/studio-product";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Failure } from "../failures/failureStates.js";
import { readProduct } from "../shell/useStudioState.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  button,
  click,
  render,
  rerender,
  typeInto,
} from "../test-utils/render.js";
import { at, drive } from "../test-utils/studioFixtures.js";
import {
  CHANGE_ID,
  LIVE_URL,
  REQUEST,
  apply,
  changing,
  changingDoc,
  liveDoc,
} from "./changeFixtures.js";
import { ChangeDrawer } from "./ChangeDrawer.js";
import { LiveSurface } from "./LiveSurface.js";

const hoisted = vi.hoisted(() => ({
  started: [] as unknown[],
}));

vi.mock("./startChange.js", () => ({
  startChange: (input: unknown) => {
    hoisted.started.push(input);
    // Task 3.1's startChange also says whether the request joined a change.
    return Promise.resolve({
      changeId: "c3",
      sessionId: "session-3",
      joined: false,
    });
  },
}));
vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDocumentSafe: () => ({ status: "loading" }),
  dispatchActions: () => Promise.resolve(undefined),
}));
// The frame has its own test; here it stands for the live app.
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

function surface(product = changing(), failure: Failure | null = null) {
  return (
    <LiveSurface
      product={product}
      productId="product-1"
      drive={DRIVE}
      documents={[]}
      failure={failure}
      now={NOW}
      story={<div data-story>Story of the change</div>}
      preview={<div data-preview>Preview of the change</div>}
      requestedBy="Ada"
      onOpenAccess={() => {}}
    />
  );
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
});

describe("Live | Preview split (spec §5.7)", () => {
  it("split shows the live app unchanged while the change builds", () => {
    const container = render(surface());
    const live = container.querySelector('[data-pane="live"]');
    const preview = container.querySelector('[data-pane="preview"]');
    expect(live?.textContent).toContain("Live — what your users see now");
    expect(live?.textContent).toContain(`Live app at ${LIVE_URL}`);
    expect(preview?.textContent).toContain(
      "Preview — your change, not live yet",
    );
    expect(preview?.textContent).toContain("Preview of the change");
    // Still building: no Ready bar, and the drawer is the change's story.
    expect(container.querySelector("[data-ready-bar]")).toBeNull();
    expect(
      container.querySelector('[data-drawer="change"] [data-story]'),
    ).not.toBeNull();
    expectNoForbiddenWords(container);
  });

  it("after launch: Version <n> is live. and the split closes", () => {
    const container = render(surface(changing("LAUNCHING")));
    expect(container.querySelector("[data-split]")).not.toBeNull();

    // The agent completes the launch: Version 2 from c2 is live.
    const product = changing("LAUNCHING");
    const change = product.changes.find((c) => c.id === CHANGE_ID)!;
    change.status = "LAUNCHED";
    product.versions[0].status = "PREVIOUS";
    product.versions.push({
      ...product.versions[0],
      number: 2,
      title: "Notes for the kitchen",
      changeId: CHANGE_ID,
      status: "LIVE",
      launchedAt: at(44),
    });
    product.liveVersion = 2;
    product.activeChangeId = null;
    rerender(container, surface(product));

    expect(container.querySelector("[data-split]")).toBeNull();
    expect(container.querySelector('[data-embed="live"]')).not.toBeNull();
    expect(container.querySelector("[data-launched]")?.textContent).toBe(
      "Version 2 is live.",
    );
    expect(container.textContent).toContain(
      "Version 2 — Notes for the kitchen",
    );
    expectNoForbiddenWords(container);
  });

  it("a failed launch shows even with the drawer closed", () => {
    const product = changing("READY");
    const container = render(surface(product));
    click(button(container, "Close"));
    expect(container.querySelector('[data-drawer="change"]')).toBeNull();

    // The launch fails: the drawer opens on the story, which shows it.
    const failed: Failure = {
      situation: "launch-failed",
      stripStep: "LIVE",
      stripIcon: "✕",
      text: "Couldn't go live: your live app didn't answer. Your live app is still on Version 1.",
      actions: [],
    };
    rerender(container, surface(product, failed));
    expect(
      container.querySelector('[data-drawer="change"] [data-story]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-split-failure]")).toBeNull();

    // Closed again while it lasts: the line sits over the preview.
    click(button(container, "Close"));
    rerender(container, surface(product, failed));
    expect(container.querySelector('[data-drawer="change"]')).toBeNull();
    expect(
      container.querySelector('[data-pane="preview"] [data-split-failure]')
        ?.textContent,
    ).toContain("Couldn't go live: your live app didn't answer.");
    expectNoForbiddenWords(container);
  });

  it("calm notices don't open the drawer", () => {
    const container = render(surface());
    click(button(container, "Close"));
    rerender(
      container,
      surface(changing(), {
        situation: "breather",
        text: "Taking a short breather.",
        actions: [],
      }),
    );
    expect(container.querySelector('[data-drawer="change"]')).toBeNull();
  });

  it("the bubble opens the drawer: past changes grouped by version", () => {
    const container = render(surface(readProduct(liveDoc().state.global)));
    expect(container.querySelector('[data-drawer="change"]')).toBeNull();
    click(button(container, "Change something"));
    const drawer = container.querySelector('[data-drawer="change"]');
    expect(drawer?.textContent).toContain("Version 1 — First version");
    expect(input(container).placeholder).toBe("What should change?");
    // The bubble is away while the drawer is open; Close brings it back.
    expect(container.querySelector('[data-bubble="change"]')).toBeNull();
    click(button(container, "Close"));
    expect(container.querySelector('[data-bubble="change"]')).not.toBeNull();
    expectNoForbiddenWords(container);
  });
});

describe("ChangeDrawer (spec §5.6)", () => {
  it("suggestion chip text is editable before sending", async () => {
    const product = readProduct(liveDoc().state.global);
    product.suggestions = [
      {
        id: "s1",
        text: "Add a Ready column",
        afterVersion: 1,
        status: "OPEN",
        kind: "IDEA",
        screenshot: null,
      },
      {
        id: "s2",
        text: "Old idea",
        afterVersion: 1,
        status: "USED",
        kind: "IDEA",
        screenshot: null,
      },
    ];
    const onStart = vi.fn(() => Promise.resolve());
    const container = render(
      <ChangeDrawer
        product={product}
        story={null}
        launchedVersion={null}
        onStart={onStart}
        onClose={() => {}}
      />,
    );
    expect(container.textContent).not.toContain("Old idea");
    click(container.querySelector('[data-suggestion="s1"]'));
    // The chip fills the box; nothing is sent yet.
    expect(input(container).value).toBe("Add a Ready column");
    expect(onStart).not.toHaveBeenCalled();

    typeInto(input(container), "Add a Ready column for breakfast orders");
    click(button(container, "Send"));
    await flush();
    // Edited, it still comes from the suggestion.
    expect(onStart).toHaveBeenCalledWith(
      "Add a Ready column for breakfast orders",
      "s1",
    );
    expect(input(container).value).toBe("");
    expectNoForbiddenWords(container);
  });

  it("What should change? starts a CHANGE through startChange", async () => {
    const container = render(surface(readProduct(liveDoc().state.global)));
    click(button(container, "Change something"));
    typeInto(input(container), "Add a notes field");
    click(button(container, "Send"));
    await flush();
    expect(hoisted.started).toEqual([
      {
        drive: DRIVE,
        productId: "product-1",
        request: "Add a notes field",
        kind: "CHANGE",
      },
    ]);
  });

  it("a change that couldn't start says so plainly and keeps the text", async () => {
    let refusal = new Error(
      "Your change is going live right now. Ask again once it's live.",
    );
    const container = render(
      <ChangeDrawer
        product={readProduct(liveDoc().state.global)}
        story={null}
        launchedVersion={null}
        onStart={() => Promise.reject(refusal)}
        onClose={() => {}}
      />,
    );
    typeInto(input(container), "Add a notes field");
    click(button(container, "Send"));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Your change is going live right now. Ask again once it's live.",
    );
    expect(input(container).value).toBe("Add a notes field");

    // A refusal from the document itself: a plain line instead.
    refusal = new Error('Change "c2" is still in progress (BUILDING).');
    click(button(container, "Send"));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't send it. Try again.",
    );
  });

  it("a discarded change stays in the story, marked discarded", () => {
    const doc = apply(
      changingDoc(),
      actions.discardChange({ changeId: CHANGE_ID, at: at(50) }),
    );
    const container = render(
      <ChangeDrawer
        product={readProduct(doc.state.global)}
        story={null}
        launchedVersion={null}
        onStart={() => Promise.resolve()}
        onClose={() => {}}
      />,
    );
    const entry = container.querySelector(`[data-change="${CHANGE_ID}"]`);
    expect(entry?.textContent).toBe(`“${REQUEST}” · discarded`);
    expect(entry?.closest("[data-version]")?.getAttribute("data-version")).toBe(
      "1",
    );
  });
});
