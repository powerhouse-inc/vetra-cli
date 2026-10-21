// @vitest-environment happy-dom
import type {
  DocumentDriveDocument,
  Node,
} from "@powerhousedao/shared/document-drive";
import type { PHDocument } from "document-model";
import { actions } from "document-models/studio-product";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  button,
  click,
  pressKey,
  render,
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
} from "../test-utils/studioFixtures.js";
import { StudioShell } from "./StudioShell.js";

const hoisted = vi.hoisted(() => ({
  documents: undefined as PHDocument[] | undefined,
  dispatched: [] as { action: unknown; id: string }[],
}));

vi.mock("../steps/plainModel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PlainModelModule>();
  return { ...actual, plainModel: vi.fn(actual.plainModel) };
});

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
  IdeaStart: () => <textarea aria-label="Your idea" />,
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
vi.mock("../budget/BudgetMeter.js", () => ({
  StudioBudgetMeter: () => <span>$0.31 of $10</span>,
  StripBudget: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("../hooks/useSessionPreviewTarget.js", () => ({
  useSessionPreviewTarget: () => undefined,
}));
vi.mock("../hooks/useResolvedPreview.js", () => ({
  useResolvedPreview: () => ({ kind: "no-target" }),
}));
vi.mock("../settings/SettingsDialog.js", () => ({
  SettingsDialog: () => <div role="dialog">Settings dialog</div>,
}));
vi.mock("../ideation/DocumentHost.js", () => ({
  DocumentHost: () => <div>Document editor</div>,
}));
vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDocumentSafe: () => ({ status: "loading" }),
  usePHToast: () => undefined,
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

beforeEach(() => {
  hoisted.documents = undefined;
  hoisted.dispatched = [];
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
    expect(
      container.querySelectorAll('[role="tab"], [role="tablist"]'),
    ).toHaveLength(0);
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
    expect(container.querySelector("aside")?.textContent).toContain(
      `Conversation ${SESSION_ID}`,
    );
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
    expect(hoisted.dispatched).toEqual([]);
    expect(container.textContent).toContain("Task board");

    click(button(container, "Rename"));
    const again = container.querySelector('input[aria-label="Product name"]');
    typeInto(again, "Team tasks");
    pressKey(again!, "Enter");
    expect(hoisted.dispatched).toMatchObject([
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

  it("live product shows the live state under the strip", () => {
    const product = productDoc(...buildingOps());
    const g = product.state.global;
    g.liveVersion = 1;
    g.liveUrl = "https://task-board.vetra.io";
    g.versions = [
      {
        number: 1,
        title: "First version",
        summary: null,
        changeId: "c1",
        gitTag: "v1",
        sha: "abc",
        packages: [],
        deploymentId: null,
        launchedAt: at(1),
        launchedBy: "Vetra",
        trigger: "AUTO",
        status: "LIVE",
        lines: [],
        changedFiles: [],
        failure: null,
        rollbackBlockedReason: null,
      },
    ];
    hoisted.documents = [product, chatDoc(SESSION_ID, 1)];
    const container = render(
      <StudioShell
        document={driveDoc([PRODUCT, SESSION])}
        dispatch={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-step="LIVE"]')?.textContent,
    ).toContain("●");
    expect(container.textContent).toContain("Version 1");
    expect(container.querySelector("aside")).toBeNull();
    expectNoForbiddenWords(container);
  });
});
