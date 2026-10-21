// @vitest-environment happy-dom
import type {
  DocumentDriveDocument,
  Node,
} from "@powerhousedao/shared/document-drive";
import type { PHDocument } from "document-model";
import { actions } from "document-models/studio-product";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chat, reply, user } from "../story/storyFixtures.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  button,
  click,
  pressKey,
  render,
  rerender,
  typeInto,
} from "../test-utils/render.js";
import { plainModel } from "../steps/plainModel.js";
import type * as PlainModelModule from "../steps/plainModel.js";
import {
  PRODUCT_ID,
  SESSION_ID,
  at,
  buildingOps,
  chatDoc,
  file,
  productDoc,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";
import { startChange } from "../change/startChange.js";
import type * as StartChangeModule from "../change/startChange.js";
import { StudioShell } from "./StudioShell.js";

const hoisted = vi.hoisted(() => ({
  documents: undefined as PHDocument[] | undefined,
  dispatched: [] as { action: unknown; id: string }[],
  /** The build's conversation as `useDocumentSafe` returns it; loading when unset. */
  session: undefined as PHDocument | undefined,
  toasts: [] as { text: string; type?: string }[],
}));
const toastFn = (text: string, o?: { type?: string }) => {
  hoisted.toasts.push({ text, type: o?.type });
};

vi.mock("../change/startChange.js", async (importOriginal) => ({
  ...(await importOriginal<typeof StartChangeModule>()),
  startChange: vi.fn(() =>
    Promise.resolve({ changeId: "c1", sessionId: "s1", joined: true }),
  ),
}));
vi.mock("../steps/plainModel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PlainModelModule>();
  return { ...actual, plainModel: vi.fn(actual.plainModel) };
});

// The conversation fixture is the story's shape, not a full document.
vi.mock(
  "@powerhousedao/clint-common/document-models/chat-session",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isChatSessionDocument: (doc: PHDocument | undefined) =>
      doc?.header.documentType === "powerhouse/chat-session",
  }),
);
vi.mock("../hooks/useDriveDocuments.js", () => ({
  useDriveDocuments: () => hoisted.documents,
}));
vi.mock("../VetraStudio.js", () => ({
  VetraStudio: () => <div>Old Studio view</div>,
}));
vi.mock("../ChatPane.js", () => ({
  ConversationPane: ({ sessionId }: { sessionId: string }) => (
    <div>Conversation {sessionId}</div>
  ),
}));
vi.mock("../idea/IdeaScreen.js", () => ({
  IdeaScreen: () => <textarea aria-label="Your idea" />,
}));
vi.mock("../BuildSection.js", () => ({
  PreviewBody: () => <div>Preview pane</div>,
}));
vi.mock("../budget/useStudioBudget.js", () => ({
  useStudioBudget: () => ({
    snapshot: {
      environmentId: null,
      usage: {
        source: "VETRA",
        model: "m",
        usageUsd: 0.31,
        limitUsd: 10,
        resetsAt: null,
      },
      exhaustedByFailure: false,
      request: { kind: "idle" },
    },
    request: () => {},
    markExhausted: () => {},
  }),
}));
// No daemon polls or sign-in lookups in shell tests.
vi.mock("../failures/useStudioRestarting.js", () => ({
  useStudioRestarting: () => false,
}));
vi.mock("../idea/useStudioSignIn.js", () => ({
  useStudioSignIn: () => ({
    status: "signed-in",
    name: undefined,
    hasUser: true,
    signIn: () => {},
    signOut: () => {},
  }),
}));
vi.mock("../budget/BudgetMeter.js", () => ({
  StudioBudgetMeter: () => <span>$0.31 of $10</span>,
  StripBudget: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("../hooks/useSessionPreviewTarget.js", () => ({
  useSessionPreviewTarget: () => undefined,
  useProjectHomeTarget: () => undefined,
}));
vi.mock("../hooks/useResolvedPreview.js", () => ({
  useResolvedPreview: () => ({ kind: "no-target" }),
}));
vi.mock("../settings/SettingsDialog.js", () => ({
  SettingsDialog: () => <div role="dialog">Settings dialog</div>,
}));
// The live embed has its own test; the shell only routes to it.
vi.mock("../live/LiveEmbed.js", () => ({
  LiveEmbed: ({ liveUrl }: { liveUrl: string }) => (
    <div data-embed="live">Live app at {liveUrl}</div>
  ),
}));
// The one-time publish ask has its own test; shell tests are about routing.
vi.mock("../permission/PublishPermissionModal.js", () => ({
  PublishPermissionModal: () => null,
}));
vi.mock("../permission/usePublishPermission.js", () => ({
  usePublishPermission: () => ({
    state: "GRANTED",
    delegated: true,
    pending: false,
    allow: () => Promise.resolve(true),
  }),
}));
vi.mock("../ideation/DocumentHost.js", () => ({
  DocumentHost: () => <div>Document editor</div>,
}));
vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDocumentSafe: () =>
    hoisted.session
      ? { status: "success", data: hoisted.session }
      : { status: "loading" },
  usePHToast: () => toastFn,
  dispatchActions: (action: unknown, id: string) => {
    hoisted.dispatched.push({ action, id });
    return Promise.resolve(undefined);
  },
}));

function driveDoc(nodes: Node[]): DocumentDriveDocument {
  return {
    header: { id: "drive-1", name: "Studio" },
    state: { global: { name: "Studio", nodes }, local: {} },
  } as unknown as DocumentDriveDocument;
}

const PRODUCT = file(PRODUCT_ID, "vetra/studio-product");
const SESSION = file(SESSION_ID, "powerhouse/chat-session");
const MODEL_ID = "model-1";

function modelDoc(): PHDocument {
  return {
    header: { id: MODEL_ID, documentType: "powerhouse/document-model" },
    state: {
      global: {
        name: "Task board",
        specifications: [
          {
            state: {
              global: {
                schema:
                  "type TaskBoardState { tasks: [Task!]! }\ntype Task { id: OID! title: String }",
              },
            },
            modules: [{ operations: [{ name: "ADD_TASK" }] }],
          },
        ],
      },
    },
  } as unknown as PHDocument;
}

function building() {
  const product = productDoc(
    ...buildingOps(),
    actions.startStep({ changeId: "c1", kind: "PLAN", at: at(2) }),
    actions.startStep({ changeId: "c1", kind: "DATA", at: at(3) }),
    actions.countStep({ changeId: "c1", kind: "DATA", done: 2, total: 3 }),
  );
  hoisted.documents = [product, chatDoc(SESSION_ID, 1), modelDoc()];
  return render(
    <StudioShell
      document={driveDoc([
        PRODUCT,
        SESSION,
        file(MODEL_ID, "powerhouse/document-model"),
      ])}
      dispatch={() => {}}
    />,
  );
}

function pressedModes(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(
      '[data-mode-switch] button[aria-pressed="true"]',
    ),
  ).map((b) => b.textContent.trim());
}

/** The split's children in order: the story's side shows where it docks. */
function sideOrder(container: HTMLElement): string[] {
  const split = container.querySelector('[role="separator"]')?.parentElement;
  return Array.from(split?.children ?? [])
    .slice(0, 3)
    .map((el) => el.tagName);
}

function chooseDock(container: HTMLElement, label: string): void {
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Chat position"]',
  );
  const option = Array.from(select?.options ?? []).find(
    (o) => o.text === label,
  );
  if (!select || !option) throw new Error(`no dock option ${label}`);
  act(() => {
    Reflect.set(HTMLSelectElement.prototype, "value", option.value, select);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The build's conversation, ending on the agent's question. */
function askingSession(): PHDocument {
  return {
    header: { id: SESSION_ID, documentType: "powerhouse/chat-session" },
    state: {
      global: chat(
        user("u1", "a task board for my team", at(1)),
        reply("r1", "Should tasks have due dates?", at(7), at(7)),
      ),
    },
  } as unknown as PHDocument;
}

function steerInput(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(
    'input[aria-label="Steer it"]',
  );
}

beforeEach(() => {
  window.localStorage.clear();
  hoisted.session = undefined;
  hoisted.documents = undefined;
  hoisted.dispatched = [];
  hoisted.toasts = [];
  vi.mocked(plainModel).mockClear();
});

describe("StudioShell", () => {
  it("an old Studio without a product document opens the old view", () => {
    hoisted.documents = [chatDoc(SESSION_ID, 3)];
    const container = render(
      <StudioShell document={driveDoc([SESSION])} dispatch={() => {}} />,
    );
    expect(container.textContent).toContain("Old Studio view");
  });

  it("idea state when the drive has no product", () => {
    hoisted.documents = [];
    const container = render(
      <StudioShell document={driveDoc([])} dispatch={() => {}} />,
    );
    expect(container.querySelector('[aria-label="Your idea"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Steps"]')).toBeNull();
    expectNoForbiddenWords(container);
  });

  it("waits for the drive before choosing a state", () => {
    const container = render(
      <StudioShell document={driveDoc([SESSION])} dispatch={() => {}} />,
    );
    expect(container.textContent).toContain("Opening your Studio…");
  });

  it("no route other than strip steps, Settings and Versions", () => {
    const container = building();
    // Only the story's layer switch (Task 1.4) is a tablist; it is not a route.
    const tabs = Array.from(
      container.querySelectorAll('[role="tab"], [role="tablist"]'),
    ).filter((el) => !el.closest('[aria-label="Story detail"]'));
    expect(tabs).toHaveLength(0);
    const names = Array.from(container.querySelectorAll("button, a")).map(
      (el) =>
        el.getAttribute("data-step") ??
        el.getAttribute("aria-label") ??
        el.textContent.trim(),
    );
    const allowed = new Set([
      "PLAN",
      "DATA",
      "EDITORS",
      "TESTS",
      "LIVE",
      "Rename",
      "Settings",
      "Versions",
      // The steer box's actions (Task 1.6), not routes.
      "Send",
      "Pause",
      // The story's layer switch (Task 1.4).
      "Outcome",
      "Activity",
      "Raw",
      // The layout switch (Task 2.3): view controls, not routes.
      "Build",
      "Review",
      "Demo",
      // Demo's thin bar returns to Review (Task 2.4).
      "Open chat",
      // Demo's visible command-bar trigger (Task 2.4).
      "Ask for a change…",
    ]);
    expect(names.filter((n) => !allowed.has(n))).toEqual([]);
    expect(names).toContain("Settings");
    expectNoForbiddenWords(container);
  });

  it("building shows the strip over the story and the preview", () => {
    const container = building();
    expect(
      container.querySelector('[data-step="DATA"]')?.textContent,
    ).toContain("2/3");
    // The story: the idea in quotes, the steer box under it.
    const story = container.querySelector("aside");
    expect(story?.textContent).toContain("“a task board for my team”");
    expect(story?.querySelector('input[aria-label="Steer it"]')).not.toBeNull();
    expect(container.textContent).toContain("Preview pane");
    expect(container.textContent).toContain("$0.31 of $10");
  });

  it("a step opens its detail and the chip returns to the build", () => {
    const container = building();
    // Models are read only for the Data step, not on every drive change.
    expect(plainModel).not.toHaveBeenCalled();
    click(container.querySelector('button[data-step="DATA"]'));
    expect(container.textContent).toContain("A Task board has tasks");
    expect(plainModel).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Preview pane");
    expectNoForbiddenWords(container);

    click(container.querySelector('button[data-step="PLAN"]'));
    expect(container.textContent).toContain("“a task board for my team”");

    click(button(container, "Back to the build"));
    expect(container.textContent).toContain("Preview pane");
  });

  it("the product name renames in place; Escape cancels", () => {
    const container = building();
    click(button(container, "Rename"));
    const input = container.querySelector('input[aria-label="Product name"]');
    typeInto(input, "Team tasks");
    pressKey(input!, "Escape");
    expect(
      hoisted.dispatched.filter(
        (d) => (d.action as { type: string }).type !== "SET_CHANGE_COST",
      ),
    ).toEqual([]);
    expect(container.textContent).toContain("Task board");

    click(button(container, "Rename"));
    const again = container.querySelector('input[aria-label="Product name"]');
    typeInto(again, "Team tasks");
    pressKey(again!, "Enter");
    expect(
      hoisted.dispatched.filter(
        (d) => (d.action as { type: string }).type !== "SET_CHANGE_COST",
      ),
    ).toMatchObject([
      {
        action: { type: "RENAME_PRODUCT", input: { name: "Team tasks" } },
        id: PRODUCT_ID,
      },
    ]);
    expect(
      container.querySelector('input[aria-label="Product name"]'),
    ).toBeNull();
  });

  it("Settings opens the settings dialog", () => {
    const container = building();
    click(button(container, "Settings"));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("in Build, a change open on a live product shows the Live | Preview split", () => {
    // The live version is there and a change is being worked on: the strip
    // stays in live mode with the change's progress; the page splits into
    // the live app and the change's preview, the drawer holds its story.
    const doc = withLiveVersion(productDoc(...buildingOps()));
    const change = doc.state.global.changes[0];
    change.status = "BUILDING";
    change.steps[0].status = "WORKING";
    hoisted.documents = [doc, chatDoc(SESSION_ID, 1)];
    const container = render(
      <StudioShell
        document={driveDoc([PRODUCT, SESSION])}
        dispatch={() => {}}
      />,
    );
    // Live defaults to Review; Build keeps today's page.
    click(button(container, "Build"));
    expect(
      container.querySelector('[data-pane="live"] [data-embed="live"]')
        ?.textContent,
    ).toBe("Live app at https://task-board.vetra.io");
    expect(
      container.querySelector('[data-pane="preview"]')?.textContent,
    ).toContain("Preview pane");
    expect(
      container.querySelector(
        '[data-drawer="change"] input[aria-label="Steer it"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-step="LIVE"]')?.textContent,
    ).toContain("●");
    expect(
      container.querySelector("[data-change-progress]")?.textContent,
    ).toContain("Change: Plan");
    expect(container.textContent).toContain("task-board.vetra.io");
    expect(container.querySelector('[data-banner="live"]')).toBeNull();
    // The live version's pills don't open a step detail over the split.
    expect(container.querySelector('button[data-step="DATA"]')).toBeNull();
    expect(container.querySelector("[data-split]")).not.toBeNull();
    expectNoForbiddenWords(container);
  });

  it("transition to the live view with the banner after the first launch", () => {
    window.localStorage.clear();
    const container = building();
    expect(container.textContent).toContain("Preview pane");
    expect(container.querySelector("aside")).not.toBeNull();

    // The launch completes while the page is open: state 2 fills the page.
    const live = withLiveVersion(productDoc(...buildingOps()));
    hoisted.documents = [live, chatDoc(SESSION_ID, 1)];
    rerender(
      container,
      <StudioShell
        document={driveDoc([PRODUCT, SESSION])}
        dispatch={() => {}}
      />,
    );
    // Once live the page opens in Review: the live app in the middle, the
    // story docked on its right.
    expect(pressedModes(container)).toEqual(["Review"]);
    expect(sideOrder(container)).toEqual(["MAIN", "DIV", "ASIDE"]);
    expect(
      container.querySelector("main [data-review-product] [data-embed='live']"),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-banner="live"]')?.textContent,
    ).toContain("Your product is live.");
    expect(container.querySelector('[data-embed="live"]')?.textContent).toBe(
      "Live app at https://task-board.vetra.io",
    );
    expect(
      container.querySelector('[data-step="LIVE"]')?.textContent,
    ).toContain("●");
    expect(
      container.querySelector('[data-step="TESTS"]')?.textContent,
    ).toContain("✓");
    expectNoForbiddenWords(container);

    // A later visit to this Studio and version: the compact line only.
    const again = render(
      <StudioShell
        document={driveDoc([PRODUCT, SESSION])}
        dispatch={() => {}}
      />,
    );
    expect(again.textContent).toContain("Went live");
    expect(again.textContent).not.toContain("Your product is live.");
  });
  it("one click switches Build → Review → Demo", () => {
    const container = building();
    expect(pressedModes(container)).toEqual(["Build"]);
    // Build: today's page, the story docked left.
    expect(sideOrder(container)).toEqual(["ASIDE", "DIV", "MAIN"]);
    expect(button(container, "Show activity")).toBeUndefined();

    click(button(container, "Review"));
    expect(pressedModes(container)).toEqual(["Review"]);
    expect(sideOrder(container)).toEqual(["MAIN", "DIV", "ASIDE"]);
    expect(
      container.querySelector("main [data-review-product]")?.textContent,
    ).toContain("Preview pane");
    expect(
      container
        .querySelector("aside [data-story-layer]")
        ?.getAttribute("data-story-layer"),
    ).toBe("outcome");

    click(button(container, "Demo"));
    expect(pressedModes(container)).toEqual(["Demo"]);
    // The product fills the page under a thin bar; the story is out of view.
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("[data-step]")).toBeNull();
    expect(container.querySelector("[data-demo-bar]")?.textContent).toContain(
      "Open chat",
    );
    expect(
      container.querySelector("[data-demo-product]")?.textContent,
    ).toContain("Preview pane");
    expect(steerInput(container)).toBeNull();
    // The chat is the command bar; Open chat returns to Review.
    pressKey(window, "k");
    expect(container.querySelector("[data-command-bar]")).toBeNull();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
      );
    });
    expect(
      container
        .querySelector("[data-command-bar] input")
        ?.getAttribute("placeholder"),
    ).toBe("Ask for a change…");
    expectNoForbiddenWords(container);
    click(button(container, "Open chat"));
    expect(pressedModes(container)).toEqual(["Review"]);
  });

  it("mode is remembered after remount", () => {
    const first = building();
    click(button(first, "Review"));
    chooseDock(first, "Chat on the bottom");
    const again = building();
    expect(pressedModes(again)).toEqual(["Review"]);
    expect(
      again.querySelector<HTMLSelectElement>(
        'select[aria-label="Chat position"]',
      )?.value,
    ).toBe("bottom");
  });

  it("the steer box and a pending question stay visible in Build and Review", () => {
    hoisted.session = askingSession();
    const container = building();
    const question = () =>
      container.querySelector('aside input[aria-label="Your answer"]');
    // Build.
    expect(container.textContent).toContain("Should tasks have due dates?");
    expect(question()).not.toBeNull();
    expect(steerInput(container)).not.toBeNull();
    expect(container.querySelector("[data-attention]")?.textContent).toBe("1");

    // A typed, unsent steer survives moving the chat.
    typeInto(steerInput(container), "make it blue");
    chooseDock(container, "Chat on the bottom");
    expect(sideOrder(container)).toEqual(["MAIN", "DIV", "ASIDE"]);
    expect(steerInput(container)?.value).toBe("make it blue");
    expect(question()).not.toBeNull();
    expect(container.querySelector<HTMLElement>("aside")?.style.minHeight).toBe(
      "240px",
    );

    // Review, in each dock.
    click(button(container, "Review"));
    for (const dock of [
      "Chat on the bottom",
      "Chat on the left",
      "Chat on the right",
    ]) {
      chooseDock(container, dock);
      expect(question()).not.toBeNull();
      expect(
        container.querySelector('aside input[aria-label="Steer it"]'),
      ).not.toBeNull();
    }
    typeInto(steerInput(container), "and bigger");
    chooseDock(container, "Chat on the left");
    expect(steerInput(container)?.value).toBe("and bigger");

    // Demo keeps the question in view and the badge on its thin bar.
    click(button(container, "Demo"));
    expect(
      container.querySelector("[data-demo-question]")?.textContent,
    ).toContain("Should tasks have due dates?");
    expect(container.querySelector("[data-attention]")?.textContent).toBe("1");
  });

  it("a question in Demo shows a badge and one toast", () => {
    hoisted.session = askingSession();
    const container = building();
    // The story is in view in Build: no toast.
    expect(hoisted.toasts).toEqual([]);
    click(button(container, "Demo"));
    expect(container.querySelector("[data-attention]")?.textContent).toBe("1");
    expect(hoisted.toasts).toHaveLength(1);
    expect(hoisted.toasts[0]).toEqual({
      text: "Should tasks have due dates? Open chat to answer.",
      type: "warning",
    });
  });

  it("the same item never toasts twice", () => {
    hoisted.session = askingSession();
    const container = building();
    click(button(container, "Demo"));
    click(button(container, "Build"));
    click(button(container, "Demo"));
    click(button(container, "Review"));
    click(button(container, "Demo"));
    expect(hoisted.toasts).toHaveLength(1);
  });

  it("Build with the story visible shows no toast, and the badge opens Review", () => {
    hoisted.session = askingSession();
    const container = building();
    expect(container.querySelector("[data-attention]")?.textContent).toBe("1");
    expect(hoisted.toasts).toEqual([]);
    click(container.querySelector<HTMLElement>("[data-attention]"));
    expect(pressedModes(container)).toEqual(["Review"]);
    expect(hoisted.toasts).toEqual([]);
  });

  function sendFromDemoBar(container: HTMLElement, text: string) {
    click(button(container, "Demo"));
    click(button(container, "Ask for a change…"));
    const field = container.querySelector<HTMLInputElement>(
      "[data-command-bar] input",
    );
    typeInto(field, text);
    pressKey(field!, "Enter");
  }

  it("Enter in the bar sends into the open change", async () => {
    vi.mocked(startChange).mockClear();
    const container = building();
    sendFromDemoBar(container, "make it blue");
    await act(async () => {});
    expect(startChange).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT_ID,
        request: "make it blue",
        kind: "CHANGE",
      }),
    );
  });

  it("with no open change Enter starts a change", async () => {
    vi.mocked(startChange).mockClear();
    hoisted.documents = [
      withLiveVersion(productDoc(...buildingOps())),
      chatDoc(SESSION_ID, 1),
    ];
    const container = render(
      <StudioShell
        document={driveDoc([PRODUCT, SESSION])}
        dispatch={() => {}}
      />,
    );
    sendFromDemoBar(container, "add a dark theme");
    await act(async () => {});
    expect(startChange).toHaveBeenCalledWith(
      expect.objectContaining({
        request: "add a dark theme",
        kind: "CHANGE",
      }),
    );
  });
});
