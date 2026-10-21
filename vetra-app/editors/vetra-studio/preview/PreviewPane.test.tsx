// @vitest-environment happy-dom
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import { actions, type Change } from "document-models/studio-product";
import { act, useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPreview } from "../hooks/useResolvedPreview.js";
import type { PreviewTarget } from "../hooks/useSessionPreviewTarget.js";
import { readProduct } from "../shell/useStudioState.js";
import { stripChange } from "../strip/stripModel.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  SCREEN_DOCS,
  toolTurn,
  type Messages,
} from "../test-utils/previewFixtures.js";
import { button, click, render } from "../test-utils/render.js";
import { at, buildingOps, productDoc } from "../test-utils/studioFixtures.js";
import { FOLLOWING_CHIP, PreviewPane, restartPreview } from "./PreviewPane.js";

const hoisted = vi.hoisted(() => ({
  resolve: (_target: PreviewTarget | undefined): ResolvedPreview => ({
    kind: "no-target",
  }),
  started: [] as string[],
  restarted: [] as string[],
  /** The autoStart option of each resolve. */
  autoStart: [] as (boolean | undefined)[],
  /** false: an older Studio without /restart. */
  hasRestart: true,
  refused: false,
}));

vi.mock("../hooks/useResolvedPreview.js", () => ({
  useResolvedPreview: (
    target: PreviewTarget | undefined,
    opts?: { autoStart?: boolean },
  ) => {
    hoisted.autoStart.push(opts?.autoStart);
    return hoisted.resolve(target);
  },
}));
vi.mock("../hooks/preview-server-client.js", () => ({
  fetchRestart: ({ project }: { project: string }) => {
    if (hoisted.refused) {
      return Promise.reject(new Error("Couldn't restart the preview."));
    }
    if (!hoisted.hasRestart) return Promise.resolve(null);
    hoisted.restarted.push(project);
    return Promise.resolve({ kind: "started" });
  },
  fetchStart: ({ project }: { project: string }) => {
    hoisted.started.push(project);
    return Promise.resolve({ kind: "already-running" });
  },
}));
vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTheme: () => ({ theme: "light" }),
}));

function ready(target: PreviewTarget | undefined): ResolvedPreview {
  if (!target) return { kind: "no-target" };
  const id = target.doc ?? target.drive ?? (target.home ? "home" : "");
  return {
    kind: "ready",
    project: target.project,
    projectPath: `/w/${target.project}`,
    driveId: "d1",
    documentId: id,
    url: `about:blank#${id}`,
  };
}

function editorsWorking(): Change {
  const product = readProduct(
    productDoc(
      ...buildingOps(),
      actions.startStep({ changeId: "c1", kind: "EDITORS", at: at(5) }),
    ).state.global,
  );
  const change = stripChange(product);
  if (!change) throw new Error("no change");
  return change;
}

function session(messages: Messages): ChatSessionDocument {
  return { state: { global: { messages } } } as unknown as ChatSessionDocument;
}

const AGENT_SHOWS_ORDER = [
  toolTurn(
    "spec-preview-create",
    { project: "hotel", type: "hotel/order", name: "Breakfast for 2" },
    'Created hotel/order "Breakfast for 2"  id: doc-o1  (drive d1)',
  ),
  toolTurn(
    "spec-preview-create",
    { project: "hotel", type: "hotel/menu", name: "Menu" },
    'Created hotel/menu "Menu"  id: doc-m1  (drive d1)',
  ),
  toolTurn(
    "spec-preview-show",
    { project: "hotel", name: "Breakfast for 2" },
    { data: { documentId: "doc-o1", documentSlug: "breakfast-for-2" } },
  ),
];

/** Renders the pane; `rerender()` re-renders it as a hot reload would. */
function mount(props: Parameters<typeof PreviewPane>[0]) {
  let rerender = () => {};
  function Harness() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    rerender = () => act(() => bump());
    // New document objects each render, as after a file change.
    return <PreviewPane {...props} documents={[...props.documents]} />;
  }
  const container = render(<Harness />);
  return { container, rerender: () => rerender() };
}

function selectedTab(container: HTMLElement): string | null | undefined {
  return container.querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent;
}

beforeEach(() => {
  hoisted.resolve = () => ({ kind: "no-target" });
  hoisted.started = [];
  hoisted.restarted = [];
  hoisted.autoStart = [];
  hoisted.hasRestart = true;
  hoisted.refused = false;
});

const PROJECT_STARTED = toolTurn(
  "reactor-project-start",
  {},
  { text: "reactor-project ready", data: { project: "hotel" } },
);

describe("PreviewPane", () => {
  it("shows the started project's drive view before the agent shares a screen", () => {
    hoisted.resolve = ready;
    const { container } = mount({
      change: null,
      documents: [],
      session: session([PROJECT_STARTED]),
    });
    const frame = container.querySelector('iframe[title="Preview"]');
    expect(frame?.getAttribute("src")).toContain("#home");
    // The home view never starts a project on its own.
    expect(hoisted.autoStart.at(-1)).toBe(false);

    // The agent's first shared screen takes over.
    const shared = mount({
      change: null,
      documents: [],
      session: session([PROJECT_STARTED, ...AGENT_SHOWS_ORDER]),
    });
    expect(
      shared.container.querySelector("iframe")?.getAttribute("src"),
    ).toContain("breakfast-for-2");
    expect(hoisted.autoStart.at(-1)).toBe(true);
  });

  it("keeps the skeleton while the started project isn't up yet", () => {
    hoisted.resolve = (target) =>
      target?.home
        ? {
            kind: "starting",
            project: "hotel",
            projectPath: "/w/hotel",
            driveId: "d1",
          }
        : { kind: "no-target" };
    const { container } = mount({
      change: null,
      documents: [],
      session: session([PROJECT_STARTED]),
    });
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain(
      "Setting up your project (about 30 s)…",
    );
    expectNoForbiddenWords(container);
  });

  it("shows a skeleton with the current activity, never a blank frame", () => {
    const props = { change: null, documents: [], session: undefined };
    let { container } = mount(props);
    expect(container.textContent).toContain(
      "Setting up your project (about 30 s)…",
    );
    expect(container.querySelector("[data-preview-skeleton]")).not.toBeNull();

    hoisted.resolve = () => ({
      kind: "starting",
      project: "hotel",
      projectPath: "/w/hotel",
      driveId: "d1",
    });
    ({ container } = mount(props));
    expect(container.textContent).toContain("Starting the preview…");

    // The frame is there, under the skeleton until it has loaded.
    hoisted.resolve = ready;
    ({ container } = mount({
      ...props,
      session: session(AGENT_SHOWS_ORDER),
    }));
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toContain("breakfast-for-2");
    expect(container.textContent).toContain("Starting the preview…");
    act(() => {
      frame?.dispatchEvent(new Event("load"));
    });
    expect(container.querySelector("[data-preview-skeleton]")).toBeNull();
    expectNoForbiddenWords(container);
  });

  it("follows the agent; a picked tab shows the chip and stays picked across reloads", () => {
    hoisted.resolve = ready;
    const { container, rerender } = mount({
      change: editorsWorking(),
      documents: SCREEN_DOCS,
      session: session(AGENT_SHOWS_ORDER),
    });
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map(
      (t) => t.textContent,
    );
    // The draft app has no tab until it is built.
    expect(tabs).toEqual(["Order editor· building…", "Menu editor"]);
    expect(selectedTab(container)).toContain("Order editor");
    expect(button(container, FOLLOWING_CHIP)).toBeUndefined();

    click(container.querySelector('[data-tab="ed-menu"]'));
    expect(selectedTab(container)).toBe("Menu editor");
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
      "doc-m1",
    );
    expect(button(container, FOLLOWING_CHIP)).toBeDefined();

    rerender();
    expect(selectedTab(container)).toBe("Menu editor");

    click(button(container, FOLLOWING_CHIP));
    expect(selectedTab(container)).toContain("Order editor");
    expect(button(container, FOLLOWING_CHIP)).toBeUndefined();
    expectNoForbiddenWords(container);
  });

  it("a picked screen without a sample yet says the preview is starting", () => {
    hoisted.resolve = ready;
    const { container } = mount({
      change: null,
      documents: SCREEN_DOCS,
      session: session([AGENT_SHOWS_ORDER[0], AGENT_SHOWS_ORDER[2]]),
    });
    click(container.querySelector('[data-tab="ed-menu"]'));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Starting the preview…");
    expect(container.textContent).not.toContain("Setting up your project");
  });

  it("restartPreview falls back to a start on a Studio without /restart", async () => {
    hoisted.resolve = ready;
    hoisted.hasRestart = false;
    mount({
      change: null,
      documents: SCREEN_DOCS,
      session: session(AGENT_SHOWS_ORDER),
    });
    await act(() => restartPreview());
    expect(hoisted.started).toEqual(["hotel"]);
  });

  it("a refused restart rejects with a plain message and doesn't start", async () => {
    hoisted.resolve = ready;
    hoisted.refused = true;
    mount({
      change: null,
      documents: SCREEN_DOCS,
      session: session(AGENT_SHOWS_ORDER),
    });
    await act(async () => {
      await expect(restartPreview()).rejects.toThrow(
        "Couldn't restart the preview.",
      );
    });
    expect(hoisted.started).toEqual([]);
  });

  it("restartPreview restarts the shown project and reloads the frame", async () => {
    hoisted.resolve = ready;
    const { container } = mount({
      change: editorsWorking(),
      documents: SCREEN_DOCS,
      session: session(AGENT_SHOWS_ORDER),
    });
    const before = container.querySelector("iframe");
    await act(() => restartPreview());
    expect(hoisted.restarted).toEqual(["hotel"]);
    expect(hoisted.started).toEqual([]);
    const after = container.querySelector("iframe");
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    // No Restart button here: the failure line owns it (Task 1.8).
    expect(button(container, "Restart preview")).toBeUndefined();
  });
});
