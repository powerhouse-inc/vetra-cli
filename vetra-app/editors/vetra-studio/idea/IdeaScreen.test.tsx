// @vitest-environment happy-dom
import type { Node } from "@powerhousedao/shared/document-drive";
import type { Action, PHDocument } from "document-model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import {
  WorkshopClientError,
  type UnderstandResult,
} from "../hooks/workshop-client.js";
import type { UnderstoodDraft } from "../../../shared/understood-draft.js";
import { setLanguage } from "../i18n/useT.js";
import {
  button,
  click,
  pressKey,
  render,
  typeInto,
} from "../test-utils/render.js";
import { defectDraft } from "../test-utils/understoodFixtures.js";
import {
  IdeaScreen,
  SIGN_IN_CHECK_TIMEOUT_MS,
  SLOW_READING_MS,
  spendText,
} from "./IdeaScreen.js";
import {
  PENDING_IDEA_MAX_AGE_MS,
  PENDING_IDEA_STORAGE_KEY,
  peekPendingIdea,
  savePendingIdea,
  takePendingIdea,
} from "./pendingIdea.js";
import { startProduct, type StartProductDeps } from "./startProduct.js";
import type { StudioSignInStatus } from "./useStudioSignIn.js";

const hoisted = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    status: "signed-in" as StudioSignInStatus,
    signIn: (() => {}) as () => void,
  };
  return {
    state,
    listeners,
    setStatus(status: StudioSignInStatus) {
      state.status = status;
      for (const l of listeners) l();
    },
    limitUsd: 10,
  };
});

vi.mock("./useStudioSignIn.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useStudioSignIn: () => {
      const status = useSyncExternalStore(
        (l) => {
          hoisted.listeners.add(l);
          return () => hoisted.listeners.delete(l);
        },
        () => hoisted.state.status,
      );
      return {
        status,
        name: undefined,
        hasUser: status === "signed-in",
        signIn: () => hoisted.state.signIn(),
        signOut: () => {},
      };
    },
  };
});
vi.mock("../budget/useStudioBudget.js", () => ({
  useStudioBudget: () => ({
    snapshot: {
      environmentId: null,
      usage: {
        source: "VETRA",
        model: "m",
        usageUsd: 0,
        limitUsd: hoisted.limitUsd,
        resetsAt: null,
      },
      exhaustedByFailure: false,
      request: { kind: "idle" },
    },
    request: () => {},
    markExhausted: () => {},
  }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePHToast: () => toast,
}));

const uploadMaterial = vi.hoisted(() => vi.fn());
const requestUnderstanding = vi.hoisted(() => vi.fn());
vi.mock("../hooks/workshop-client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadMaterial,
  requestUnderstanding,
}));

const HOTEL = "Hotel breakfast orders";

function textarea(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector('textarea[aria-label="Your idea"]');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("no idea box");
  return el;
}

function typeIdea(container: HTMLElement, value: string): void {
  const el = textarea(container);
  act(() => {
    Reflect.set(HTMLTextAreaElement.prototype, "value", value, el);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function screen(
  onStart = vi.fn((_idea: string) =>
    Promise.resolve<string | undefined>("session-1"),
  ),
) {
  const onStarted = vi.fn();
  const container = render(
    <IdeaScreen
      onStart={onStart}
      onStarted={onStarted}
      onOpenSettings={() => {}}
    />,
  );
  return { container, onStart, onStarted };
}

beforeEach(() => {
  window.localStorage.clear();
  hoisted.state.status = "signed-in";
  hoisted.state.signIn = () => {};
  hoisted.limitUsd = 10;
});

afterEach(() => {
  window.localStorage.clear();
});

describe("IdeaScreen", () => {
  it("shows the spec copy, the budget and the account menu", () => {
    const { container } = screen();
    expect(container.querySelector("h1")?.textContent).toBe(
      "What do you want to build?",
    );
    expect(textarea(container).placeholder).toBe(
      "Describe your product in a sentence or two — who it's for and what they do with it.",
    );
    expect(button(container, "Build it")).toBeDefined();
    for (const chip of [HOTEL, "Maintenance requests", "Invoice approvals"]) {
      expect(button(container, chip)).toBeDefined();
    }
    expect(container.textContent).toContain("$10 to spend");
    expect(button(container, "Account")).toBeDefined();
    // No strip, no session list, no tabs.
    expect(container.querySelector('[aria-label="Steps"]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(button(container, "New session")).toBeUndefined();
    expectNoForbiddenWords(container);
  });

  it("chip fills the input without building", () => {
    const { container, onStart } = screen();
    click(button(container, HOTEL));
    expect(textarea(container).value).toBe(HOTEL);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("signed-in Build it starts the build with the idea", async () => {
    const { container, onStart, onStarted } = screen();
    typeIdea(container, "  Maintenance requests for a hostel  ");
    click(button(container, "Build it"));
    await flush();
    expect(onStart).toHaveBeenCalledExactlyOnceWith(
      "Maintenance requests for a hostel",
    );
    expect(onStarted).toHaveBeenCalledWith("session-1");
    expect(peekPendingIdea()).toBeNull();
  });

  it("signed-out Build it stores the idea and opens sign-in", async () => {
    hoisted.state.status = "signed-out";
    const signIn = vi.fn();
    hoisted.state.signIn = signIn;
    const { container, onStart } = screen();
    typeIdea(container, HOTEL);
    click(button(container, "Build it"));
    await flush();
    expect(signIn).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
    expect(peekPendingIdea()).toBe(HOTEL);
  });

  it("idea survives the sign-in round trip and is sent once", async () => {
    // Before the redirect: signed out, Build it keeps the idea.
    hoisted.state.status = "signed-out";
    const left = document.createElement("div");
    document.body.appendChild(left);
    const leftRoot = createRoot(left);
    const leftStart = vi.fn((_idea: string) => Promise.resolve("session-1"));
    act(() =>
      leftRoot.render(
        <IdeaScreen
          onStart={leftStart}
          onStarted={() => {}}
          onOpenSettings={() => {}}
        />,
      ),
    );
    typeIdea(left, HOTEL);
    click(button(left, "Build it"));
    // The redirect leaves the page.
    act(() => leftRoot.unmount());
    left.remove();

    // Back from sign-in: a fresh page, still checking who is signed in.
    hoisted.state.status = "checking";
    const { container, onStart } = screen();
    await flush();
    expect(textarea(container).value).toBe(HOTEL);
    expect(onStart).not.toHaveBeenCalled();

    act(() => hoisted.setStatus("signed-in"));
    await flush();
    expect(onStart).toHaveBeenCalledExactlyOnceWith(HOTEL);
    expect(window.localStorage.getItem(PENDING_IDEA_STORAGE_KEY)).toBeNull();

    // Later status changes do not send it again.
    act(() => hoisted.setStatus("checking"));
    act(() => hoisted.setStatus("signed-in"));
    await flush();
    expect(onStart).toHaveBeenCalledOnce();
    expect(leftStart).not.toHaveBeenCalled();
  });

  it("Build it while sign-in is still checking waits, then opens sign-in", async () => {
    hoisted.state.status = "checking";
    const signIn = vi.fn();
    hoisted.state.signIn = signIn;
    const { container, onStart } = screen();
    typeIdea(container, HOTEL);
    click(button(container, "Build it"));
    expect(button(container, "Starting…")).toBeDefined();
    act(() => hoisted.setStatus("signed-out"));
    await flush();
    expect(signIn).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
    expect(peekPendingIdea()).toBe(HOTEL);
  });

  it("keeps the idea until the start succeeds", async () => {
    savePendingIdea(HOTEL);
    hoisted.state.status = "checking";
    const onStart = vi
      .fn((_idea: string): Promise<string | undefined> =>
        Promise.resolve("session-1"),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const { container } = screen(onStart);
    act(() => hoisted.setStatus("signed-in"));
    await flush();

    // The start failed: the idea is still kept and still in the box.
    expect(onStart).toHaveBeenCalledExactlyOnceWith(HOTEL);
    expect(peekPendingIdea()).toBe(HOTEL);
    expect(textarea(container).value).toBe(HOTEL);

    // Build it again succeeds: the product exists, the idea is cleared.
    click(button(container, "Build it"));
    await flush();
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(peekPendingIdea()).toBeNull();
  });

  it("gives the button back when sign-in never settles", () => {
    vi.useFakeTimers();
    try {
      hoisted.state.status = "checking";
      const { container } = screen();
      typeIdea(container, HOTEL);
      click(button(container, "Build it"));
      expect(button(container, "Starting…")).toBeDefined();
      act(() => {
        vi.advanceTimersByTime(SIGN_IN_CHECK_TIMEOUT_MS);
      });
      expect(button(container, "Build it")?.disabled).toBe(false);
      expect(peekPendingIdea()).toBe(HOTEL);
    } finally {
      vi.useRealTimers();
    }
  });

  it("first story line appears immediately", async () => {
    const s = memoryStudio();
    const onStart = vi.fn(async (idea: string): Promise<string | undefined> => {
      const result = await startProduct({ drive: s.drive, idea }, s.deps);
      return result.sessionId;
    });
    const { container } = screen(onStart);
    click(button(container, HOTEL));
    const pressed = Date.now();
    click(button(container, "Build it"));
    await flush();

    const change = (
      s.docs.get("product-2")?.changes as { milestones: { text: string }[] }[]
    )[0];
    expect(change.milestones.map((m) => m.text)).toEqual([
      "Got it — planning Hotel breakfast orders.",
    ]);
    expect(Date.now() - pressed).toBeLessThan(2000);
    // Written with the change, before the first message starts the agent.
    expect(s.dispatched).toEqual([
      ["INIT_PRODUCT", "START_CHANGE", "ADD_MILESTONE"],
      ["ADD_USER_MESSAGE"],
    ]);
  });
});

describe("pendingIdea", () => {
  it("keeps, peeks and takes the idea once", () => {
    savePendingIdea("  Invoice approvals ");
    expect(peekPendingIdea()).toBe("Invoice approvals");
    expect(takePendingIdea()).toBe("Invoice approvals");
    expect(takePendingIdea()).toBeNull();
  });

  it("ignores empty, damaged and stale ideas", () => {
    savePendingIdea("   ");
    expect(peekPendingIdea()).toBeNull();
    window.localStorage.setItem(PENDING_IDEA_STORAGE_KEY, "{not json");
    expect(takePendingIdea()).toBeNull();
    savePendingIdea("Old idea", 1_000);
    expect(peekPendingIdea(1_000 + PENDING_IDEA_MAX_AGE_MS + 1)).toBeNull();
  });

  it("works without storage", () => {
    const spy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      expect(() => savePendingIdea("x")).not.toThrow();
      expect(takePendingIdea()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("spendText", () => {
  it("shows what is left of the limit", () => {
    expect(spendText({ usageUsd: 0, limitUsd: 10 })).toBe("$10 to spend");
    expect(spendText({ usageUsd: 0.31, limitUsd: 10 })).toBe("$9.69 to spend");
    expect(spendText({ usageUsd: 12, limitUsd: 10 })).toBe("$0 to spend");
    expect(spendText({ usageUsd: 1, limitUsd: null })).toBe("");
    expect(spendText(null)).toBe("");
  });
});

/** An in-memory drive and reactor for the few actions startProduct sends. */
function memoryStudio() {
  const nodes: Node[] = [];
  const docs = new Map<string, Record<string, unknown>>();
  const dispatched: string[][] = [];
  let ids = 0;
  const deps: StartProductDeps = {
    addDocument: (_driveId, name, documentType) => {
      const id = documentType.endsWith("studio-product")
        ? `product-${++ids}`
        : `session-${++ids}`;
      nodes.push({
        id,
        name,
        kind: "file",
        documentType,
        parentFolder: null,
      });
      docs.set(
        id,
        id.startsWith("product") ? { changes: [] } : { messages: [] },
      );
      return Promise.resolve({ id });
    },
    dispatch: (id: string, actions: Action[]) => {
      dispatched.push(actions.map((a) => a.type));
      const g = docs.get(id)!;
      for (const a of actions) {
        const input = a.input as Record<string, unknown>;
        const changes = g.changes as Record<string, unknown>[];
        if (a.type === "START_CHANGE")
          changes.push({ ...input, milestones: [] });
        if (a.type === "ADD_MILESTONE") {
          const change = changes.find((c) => c.id === input.changeId)!;
          (change.milestones as unknown[]).push(input);
        }
        if (a.type === "ADD_USER_MESSAGE") {
          (g.messages as unknown[]).push({ ...input, role: "USER" });
        }
      }
      return Promise.resolve();
    },
    getDocument: (id: string) =>
      Promise.resolve(
        docs.has(id)
          ? ({
              header: { id },
              state: { global: docs.get(id) },
            } as unknown as PHDocument)
          : undefined,
      ),
    now: () => "2026-10-21T10:00:00.000Z",
    newId: () => `id-${++ids}`,
    waitUntilReady: () => Promise.resolve(true),
  };
  return {
    drive: { header: { id: "drive-idea" }, state: { global: { nodes } } },
    docs,
    dispatched,
    deps,
  };
}

describe("IdeaScreen with material", () => {
  function dropFile(container: HTMLElement): void {
    const target = container.querySelector("textarea") as HTMLElement;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [new File(["x"], "orders.csv", { type: "text/csv" })],
        types: ["Files"],
        items: [],
      },
    });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  function withMaterial(props: Partial<Parameters<typeof IdeaScreen>[0]> = {}) {
    const onStart = vi.fn((_idea: string) =>
      Promise.resolve<string | undefined>("session-1"),
    );
    const onStarted = vi.fn();
    const container = render(
      <IdeaScreen
        onStart={onStart}
        onStarted={onStarted}
        onOpenSettings={() => {}}
        {...props}
      />,
    );
    return { container, onStart, onStarted };
  }

  function result(): UnderstandResult {
    return { draft: defectDraft(), notes: [], costUsd: 0.01, ms: 900 };
  }

  beforeEach(() => {
    uploadMaterial.mockReset();
    requestUnderstanding.mockReset();
    toast.mockReset();
    uploadMaterial.mockResolvedValue({
      id: "m1",
      name: "orders.csv",
      kind: "SHEET",
      sheets: [{ sheet: "s", header: ["a"], rowCount: 7 }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setLanguage(null);
  });

  it("with a file the button asks to show what was understood", async () => {
    const { container } = withMaterial();
    expect(button(container, "Build it")).toBeDefined();
    expect(container.textContent).toContain(
      "Your files are read by the AI model this Studio uses.",
    );
    dropFile(container);
    await flush();
    expect(container.textContent).toContain("7 rows");
    expect(button(container, "Show me what you understood")).toBeDefined();
    expect(button(container, "Build it")).toBeUndefined();
    expectNoForbiddenWords(container);
  });

  it("the button speaks German when the language is German", async () => {
    setLanguage("de");
    const { container } = withMaterial();
    dropFile(container);
    await flush();
    expect(container.textContent).toContain("7 Zeilen");
    expect(button(container, "Zeig mir, was du verstanden hast")).toBeDefined();
    expectNoForbiddenWords(container);
  });

  it("reads the files, waits with them, and says big diagrams take longer", async () => {
    requestUnderstanding.mockReturnValue(new Promise(() => {}));
    const { container } = withMaterial();
    typeIdea(container, "Defects on site");
    dropFile(container);
    await flush();
    vi.useFakeTimers();
    click(button(container, "Show me what you understood"));
    expect(requestUnderstanding).toHaveBeenCalledWith(
      { materialIds: ["m1"], text: "Defects on site", language: "en" },
      expect.any(AbortSignal),
    );
    const waiting = container.querySelector('[role="status"]');
    expect(waiting?.textContent).toContain("Reading your material…");
    expect(waiting?.textContent).toContain("orders.csv");
    expect(container.textContent).not.toContain("Almost there");
    act(() => {
      vi.advanceTimersByTime(SLOW_READING_MS);
    });
    expect(container.textContent).toContain(
      "Almost there — big diagrams take up to a minute.",
    );
    expectNoForbiddenWords(container);
  });

  it("shows what was understood; Back keeps the draft; Build this starts", async () => {
    requestUnderstanding.mockResolvedValue(result());
    const { container, onStart, onStarted } = withMaterial();
    typeIdea(container, "Defects on site");
    dropFile(container);
    await flush();
    click(button(container, "Show me what you understood"));
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe(
      "What I understood",
    );
    click(button(container, "Mangel"));
    const input = container.querySelector('input[aria-label="Mangel"]');
    typeInto(input, "Baumangel");
    pressKey(input as Element, "Enter");
    click(button(container, "Back"));
    expect(textarea(container).closest("[hidden]")).toBeNull();
    expect(container.textContent).toContain("orders.csv");
    click(button(container, "Show me what you understood"));
    await flush();
    expect(requestUnderstanding).toHaveBeenCalledTimes(1);
    expect(button(container, "Baumangel")).toBeDefined();
    click(button(container, "Build this"));
    await flush();
    // Until the build takes the draft (Task 1.7), the idea text starts it.
    expect(onStart).toHaveBeenCalledWith("Defects on site");
    expect(onStarted).toHaveBeenCalledWith("session-1");
  });

  it("hands the corrected draft to onBuildDraft when it is given", async () => {
    requestUnderstanding.mockResolvedValue(result());
    const onBuildDraft = vi.fn(
      (_input: {
        idea: string;
        draft: UnderstoodDraft;
        language: "en" | "de";
      }) => Promise.resolve<string | undefined>("session-2"),
    );
    const { container, onStart, onStarted } = withMaterial({ onBuildDraft });
    dropFile(container);
    await flush();
    click(button(container, "Show me what you understood"));
    await flush();
    click(button(container, "Build this"));
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    expect(onBuildDraft).toHaveBeenCalledTimes(1);
    const [handed] = onBuildDraft.mock.calls[0];
    expect(handed.idea).toBe("");
    expect(handed.language).toBe("en");
    expect(handed.draft.summary).toBe(defectDraft().summary);
    expect(onStarted).toHaveBeenCalledWith("session-2");
  });

  it("files that can't be read show their notes and keep the idea box", async () => {
    requestUnderstanding.mockRejectedValue(
      new WorkshopClientError("unreadable", [
        { materialId: "m1", text: "This sheet is empty." },
      ]),
    );
    const { container } = withMaterial();
    typeIdea(container, "Defects on site");
    dropFile(container);
    await flush();
    click(button(container, "Show me what you understood"));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This sheet is empty.",
    );
    expect(textarea(container).closest("[hidden]")).toBeNull();
    expect(textarea(container).value).toBe("Defects on site");
  });

  it("a used-up budget is said in the user's language", async () => {
    setLanguage("de");
    requestUnderstanding.mockRejectedValue(new WorkshopClientError("budget"));
    const { container } = withMaterial();
    dropFile(container);
    await flush();
    click(button(container, "Zeig mir, was du verstanden hast"));
    await flush();
    expect(toast).toHaveBeenCalledWith("Dein Budget ist aufgebraucht.", {
      type: "error",
    });
    expect(container.querySelector("textarea")?.closest("[hidden]")).toBeNull();
  });

  it("signed out, a drop asks to sign in and uploads nothing", async () => {
    hoisted.state.status = "signed-out";
    const signIn = vi.fn();
    hoisted.state.signIn = signIn;
    const { container } = screen();
    typeIdea(container, HOTEL);
    dropFile(container);
    await flush();
    expect(uploadMaterial).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Sign in to add files");
    expect(signIn).toHaveBeenCalled();
    expect(peekPendingIdea()).toBe(HOTEL);
  });
});
