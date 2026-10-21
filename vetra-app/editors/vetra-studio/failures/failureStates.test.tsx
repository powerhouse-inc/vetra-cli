// @vitest-environment happy-dom
import type { Message } from "@powerhousedao/clint-common/document-models/chat-session";
import {
  actions,
  reducer,
  type StudioProductAction,
} from "document-models/studio-product";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProduct } from "../shell/useStudioState.js";
import { StoryPane, type StoryFailureContext } from "../story/StoryPane.js";
import { atSec, chat, reply, user } from "../story/storyFixtures.js";
import type { StoryChat } from "../story/storyModel.js";
import { stripModel } from "../strip/stripModel.js";
import { PHASE_AVERAGES } from "../strip/timeLeft.js";
import { expectNoForbiddenWords } from "../test-utils/forbiddenWords.js";
import { button, click, render } from "../test-utils/render.js";
import {
  PRODUCT_ID,
  SESSION_ID,
  at,
  buildingOps,
  productDoc,
  withFailedLaunch,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";
import {
  FailureLine,
  SignInModal,
  SIGNED_OUT_TITLE,
  useFailureHandlers,
} from "./FailureLine.js";
import {
  INITIAL_WATCH,
  isRestarting,
  nextWatch,
} from "./useStudioRestarting.js";
import {
  ASK_AGENT_TO_FIX,
  LIVE_UNHEALTHY,
  PERMISSION_NEEDED,
} from "../live/liveCopy.js";
import {
  BREATHER_TEXT,
  BUDGET_USED_UP_TEXT,
  BUDGET_WARNING_TEXT,
  NOT_DELIVERED_TEXT,
  PREVIEW_SLOW_TEXT,
  RESTARTING_TEXT,
  RESTART_FAILED_TEXT,
  RETRIED_TEXT,
  TURN_FAILED_TEXT,
  failureFor,
  withFailure,
  type FailureBudget,
} from "./failureStates.js";

type Dispatched = {
  action: { type: string; input: Record<string, unknown> };
  id: string;
};

const hoisted = vi.hoisted(() => ({ dispatched: [] as Dispatched[] }));

vi.mock("@powerhousedao/reactor-browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePHToast: () => undefined,
  dispatchActions: (
    action: Dispatched["action"] | Dispatched["action"][],
    id: string,
  ) => {
    for (const a of Array.isArray(action) ? action : [action]) {
      hoisted.dispatched.push({ action: a, id });
    }
    return Promise.resolve();
  },
}));

beforeEach(() => {
  hoisted.dispatched = [];
});

/** Lets the actions' promises settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function product(...ops: StudioProductAction[]) {
  return readProduct(productDoc(...buildingOps(), ...ops).state.global);
}

function changeOf(p: ReturnType<typeof product>) {
  const change = p.changes.find((c) => c.id === "c1");
  if (!change) throw new Error("no change");
  return change;
}

const working = [
  actions.startStep({ changeId: "c1", kind: "DATA", at: at(2) }),
] satisfies StudioProductAction[];

function failed(
  id: string,
  userMessageId: string,
  createdAt: string,
  message = "The model provider returned an error: 503",
  code = "PROVIDER_ERROR",
): Message {
  return {
    ...reply(id, "", createdAt, createdAt),
    content: [],
    finishReason: "error",
    failure: {
      code,
      failedAt: createdAt,
      message,
      retryable: true,
      userMessageId,
    },
  };
}

function idea(): Message {
  return user("u0", "a task board for my team", at(1), at(1));
}

function renderStory(
  p: ReturnType<typeof product>,
  c: StoryChat,
  context: Partial<StoryFailureContext> = {},
  now = new Date(at(10)),
) {
  return render(
    <StoryPane
      product={p}
      change={changeOf(p)}
      chat={c}
      sessionId={SESSION_ID}
      productId={PRODUCT_ID}
      now={now}
      failureContext={{
        budget: null,
        requestBudget: () => {},
        studioRestarting: false,
        restartPreview: () => Promise.resolve(),
        ...context,
      }}
    />,
  );
}

function failureLine(container: HTMLElement): HTMLElement | null {
  return container.querySelector("[data-failure]");
}

function stripIcon(
  p: ReturnType<typeof product>,
  c: StoryChat,
  budget: FailureBudget = null,
  studioRestarting = false,
) {
  const view = withFailure(
    stripModel(p, {
      budget: null,
      averages: PHASE_AVERAGES,
      now: new Date(at(10)),
    }),
    failureFor(p, c, budget, { studioRestarting }, { now: new Date(at(10)) }),
  );
  return Object.fromEntries(view.steps.map((s) => [s.kind, s.icon]));
}

describe("build failure states (spec §5.9, G4)", () => {
  it("a retried turn shows a small ⟲ line and nothing else", () => {
    const p = product(...working);
    const c = chat(
      idea(),
      {
        ...reply("a1", "", at(2), at(2)),
        finishReason: "retry",
      },
      reply("a2", "Planning the data.", at(3)),
    );
    const container = renderStory(p, c);
    expect(failureLine(container)?.textContent).toBe(RETRIED_TEXT);
    expect(failureLine(container)?.querySelector("button")).toBeNull();
    expect(stripIcon(p, c).DATA).toBe("◐");
    expectNoForbiddenWords(container);
  });

  it("a failed turn says the AI service didn't respond; Retry re-runs it, Continue opens the box", async () => {
    const p = product(...working);
    const c = chat(idea(), failed("a1", "u0", at(3)));
    const container = renderStory(p, c);
    expect(failureLine(container)?.textContent).toContain(TURN_FAILED_TEXT);
    expect(stripIcon(p, c).DATA).toBe("✕");
    expectNoForbiddenWords(container);

    click(button(container, "Retry"));
    await settle();
    expect(hoisted.dispatched.map((d) => [d.id, d.action.type])).toEqual([
      [SESSION_ID, "RETRY_TURN"],
    ]);
    expect(hoisted.dispatched[0].action.input.userMessageId).toBe("u0");

    click(button(container, "Continue"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Steer it");
  });

  it("a turn stopped by Pause is not a failure (F16)", () => {
    const paused = product(
      ...working,
      actions.pauseChange({ changeId: "c1", at: at(3) }),
    );
    const stopped = chat(idea(), failed("a1", "u0", at(3)));
    expect(
      failureFor(
        paused,
        stopped,
        null,
        { studioRestarting: false },
        { now: new Date(at(4)) },
      ),
    ).toBeNull();
    const none = { studioRestarting: false };
    const now = { now: new Date(at(4)) };
    const byCode = chat(
      idea(),
      failed("a1", "u0", at(3), "Stopped.", "PAUSED"),
    );
    expect(failureFor(product(...working), byCode, null, none, now)).toBeNull();
    const byReason = chat(idea(), {
      ...failed("a1", "u0", at(3)),
      finishReason: "paused",
    });
    expect(
      failureFor(product(...working), byReason, null, none, now),
    ).toBeNull();
    // The word alone in a real failure's message is not a pause.
    const worded = chat(
      idea(),
      failed("a1", "u0", at(3), "The provider paused the stream: 503"),
    );
    expect(
      failureFor(product(...working), worded, null, none, now)?.situation,
    ).toBe("turn-failed");
  });

  it("stuck: one stuck line saying what it tried; its actions steer the agent", async () => {
    const p = product(
      ...working,
      actions.markStuck({
        changeId: "c1",
        reason: "the kitchen-queue drag-and-drop",
        tried: ["Try 1: a drag handle", "Try 2: a library", "Try 3: buttons"],
        at: at(8),
      }),
    );
    const c = chat(idea(), reply("a1", "Working.", at(2), at(7)));
    const container = renderStory(p, c);
    const text = container.textContent;
    expect(text).toContain(
      "I'm stuck on the kitchen-queue drag-and-drop. I tried 3 ways.",
    );
    expect(text.split("I'm stuck").length - 1).toBe(1);
    expect(failureLine(container)).toBeNull();
    expect(stripIcon(p, c).DATA).toBe("!");
    expectNoForbiddenWords(container);

    click(button(container, "Try a simpler version"));
    click(button(container, "Skip this part"));
    await settle();
    expect(
      hoisted.dispatched.map((d) => [
        d.id,
        d.action.type,
        d.action.input.content,
      ]),
    ).toEqual([
      [
        SESSION_ID,
        "ADD_USER_MESSAGE",
        [expect.objectContaining({ text: "Try a simpler version." })],
      ],
      [
        SESSION_ID,
        "ADD_USER_MESSAGE",
        [expect.objectContaining({ text: "Skip this part for now." })],
      ],
    ]);
    click(button(container, "Tell me how"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Steer it");
  });

  it("the second step-cap hit asks: Taking a breather · Continue puts the step back to work", async () => {
    const p = product(
      ...working,
      actions.setStepAttention({
        changeId: "c1",
        kind: "DATA",
        status: "NEEDS_YOU",
        reason: "Taking a breather",
        at: at(9),
      }),
    );
    const c = chat(idea(), {
      ...reply("a1", "", at(8), at(9)),
      finishReason: "tool-calls",
    });
    const container = renderStory(p, c);
    const line = failureLine(container);
    expect(line?.dataset.failure).toBe("breather");
    expect(line?.textContent).toContain(BREATHER_TEXT);
    // The step's "!" line is replaced, not repeated.
    expect(container.querySelectorAll("[data-line=attention]").length).toBe(1);
    expect(container.textContent.split(BREATHER_TEXT).length - 1).toBe(1);
    expectNoForbiddenWords(container);

    click(button(line ?? container, "Continue"));
    await settle();
    expect(hoisted.dispatched.map((d) => [d.id, d.action.type])).toEqual([
      [PRODUCT_ID, "SET_STEP_ATTENTION"],
      [SESSION_ID, "ADD_USER_MESSAGE"],
    ]);
    expect(hoisted.dispatched[0].action.input).toMatchObject({
      changeId: "c1",
      kind: "DATA",
      status: "WORKING",
    });
    expect(hoisted.dispatched[1].action.input.content).toEqual([
      expect.objectContaining({ text: "continue" }),
    ]);
  });

  it("budget at 80 % says so, with no action", () => {
    const p = product(...working);
    const c = chat(idea(), reply("a1", "Working.", at(2)));
    const container = renderStory(p, c, {
      budget: { level: "warning", request: { kind: "idle" } },
    });
    expect(failureLine(container)?.textContent).toBe(BUDGET_WARNING_TEXT);
    expect(failureLine(container)?.querySelector("button")).toBeNull();
    expectNoForbiddenWords(container);
  });

  it("budget used up: work is saved, Request more budget asks for more", () => {
    const requestBudget = vi.fn();
    const p = product(...working);
    const c = chat(
      idea(),
      failed(
        "a1",
        "u0",
        at(3),
        "Not enough credits to continue.",
        "BUDGET_EXHAUSTED",
      ),
    );
    const container = renderStory(p, c, { requestBudget });
    const line = failureLine(container);
    expect(line?.textContent).toContain(BUDGET_USED_UP_TEXT);
    expect(line?.textContent).not.toContain(TURN_FAILED_TEXT);
    expect(stripIcon(p, c).DATA).toBe("!");
    expectNoForbiddenWords(container);
    click(button(container, "Request more budget"));
    expect(requestBudget).toHaveBeenCalledTimes(1);
  });

  it("a message not picked up in 60 s says Not delivered yet; Retry asks again", async () => {
    const p = product(...working);
    const c = chat(
      idea(),
      reply("a1", "Working.", at(2), at(3)),
      user("u1", "add a priority field", at(5)),
    );
    const container = renderStory(p, c, {}, new Date(atSec(6, 30)));
    const steer = container.querySelector("[data-line=steer]");
    expect(steer?.textContent).toContain(NOT_DELIVERED_TEXT);
    expect(failureLine(container)).toBeNull();
    expectNoForbiddenWords(container);

    click(button(steer as HTMLElement, "Retry"));
    await settle();
    expect(hoisted.dispatched.map((d) => [d.id, d.action.type])).toEqual([
      [SESSION_ID, "RETRY_TURN"],
    ]);
    expect(hoisted.dispatched[0].action.input.userMessageId).toBe("u1");
  });

  it("an idea not picked up in 60 s gets its own Not delivered yet line", async () => {
    const p = product();
    const c = chat(user("u0", "a task board for my team", at(1)));
    const container = renderStory(p, c, {}, new Date(atSec(2, 30)));
    const line = failureLine(container);
    expect(line?.textContent).toContain(NOT_DELIVERED_TEXT);
    click(button(line ?? container, "Retry"));
    await settle();
    expect(hoisted.dispatched.map((d) => [d.id, d.action.type])).toEqual([
      [SESSION_ID, "RETRY_TURN"],
    ]);
    expect(hoisted.dispatched[0].action.input.userMessageId).toBe("u0");
  });

  it("preview slow: Restart preview restarts it, and says so when it can't", async () => {
    const restartPreview = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("preview-server /restart: 500"));
    const p = product(
      ...working,
      actions.setStepAttention({
        changeId: "c1",
        kind: "EDITORS",
        status: "NEEDS_YOU",
        reason: PREVIEW_SLOW_TEXT,
        at: at(9),
      }),
    );
    const c = chat(idea(), reply("a1", "Starting the preview.", at(8)));
    const container = renderStory(p, c, { restartPreview });
    const line = failureLine(container);
    expect(line?.textContent).toContain(PREVIEW_SLOW_TEXT);
    expect(stripIcon(p, c).EDITORS).toBe("!");
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(
      Array.from(container.querySelectorAll("button")).filter((b) =>
        b.textContent.includes("Restart preview"),
      ).length,
    ).toBe(1);
    expectNoForbiddenWords(container);

    click(button(container, "Restart preview"));
    await settle();
    expect(restartPreview).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role=alert]")).toBeNull();

    click(button(container, "Restart preview"));
    await settle();
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      RESTART_FAILED_TEXT,
    );
  });

  it("checks keep failing: says which, Let the agent try again sends it back", async () => {
    const p = product(
      ...working,
      actions.recordCheckRun({
        changeId: "c1",
        id: "r1",
        at: at(8),
        results: [
          { kind: "GENERATE", passed: true },
          {
            kind: "TYPECHECK",
            passed: false,
            reason: "A field's type doesn't match",
          },
          { kind: "LINT", passed: false, reason: "2 unused variables" },
          { kind: "REDUCER_TESTS", passed: true },
          { kind: "SMOKE", passed: true },
        ],
      }),
    );
    const c = chat(
      idea(),
      reply("a1", "I couldn't fix the checks.", at(8), at(9)),
    );
    const container = renderStory(p, c);
    const line = failureLine(container);
    expect(line?.textContent).toContain(
      "2 checks still fail: A field's type doesn't match; 2 unused variables",
    );
    expect(stripIcon(p, c).TESTS).toBe("✕");
    expectNoForbiddenWords(container);

    click(button(line ?? container, "Let the agent try again"));
    await settle();
    expect(hoisted.dispatched.map((d) => [d.id, d.action.type])).toEqual([
      [SESSION_ID, "ADD_USER_MESSAGE"],
    ]);
  });

  it("Go live anyway is absent when the Tests gate would still fail after the waiver", () => {
    const lintOnly = (
      results: {
        kind: "GENERATE" | "TYPECHECK" | "LINT" | "REDUCER_TESTS" | "SMOKE";
        at: string;
      }[],
    ) =>
      results.map(({ kind, at: runAt }, i) =>
        actions.recordCheckRun({
          changeId: "c1",
          id: `r${i}`,
          at: runAt,
          results: [
            kind === "LINT"
              ? { kind, passed: false, reason: "2 unused variables" }
              : { kind, passed: true },
          ],
        }),
      );
    const c = chat(idea(), reply("a1", "Only lint is left.", at(8), at(9)));
    const none = { studioRestarting: false };
    const now = { now: new Date(at(10)) };
    // The type check predates the latest code generation.
    const stale = product(
      ...working,
      ...lintOnly([
        { kind: "TYPECHECK", at: at(5) },
        { kind: "SMOKE", at: at(7) },
        { kind: "REDUCER_TESTS", at: at(7) },
        { kind: "GENERATE", at: at(6) },
        { kind: "LINT", at: at(7) },
      ]),
    );
    const staleFailure = failureFor(stale, c, null, none, now);
    expect(staleFailure?.situation).toBe("checks-failing");
    expect(staleFailure?.actions.map((a) => a.label)).toEqual([
      "Let the agent try again",
    ]);
    // A check that never ran.
    const missing = product(
      ...working,
      ...lintOnly([
        { kind: "GENERATE", at: at(5) },
        { kind: "TYPECHECK", at: at(6) },
        { kind: "LINT", at: at(7) },
      ]),
    );
    expect(
      failureFor(missing, c, null, none, now)?.actions.map((a) => a.label),
    ).toEqual(["Let the agent try again"]);
  });

  it("Go live anyway is absent when a type check fails", () => {
    const p = product(
      ...working,
      actions.recordCheckRun({
        changeId: "c1",
        id: "r1",
        at: at(8),
        results: [
          {
            kind: "TYPECHECK",
            passed: false,
            reason: "A field's type doesn't match",
          },
          { kind: "LINT", passed: false, reason: "2 unused variables" },
        ],
      }),
    );
    const c = chat(idea(), reply("a1", "Done trying.", at(8), at(9)));
    const container = renderStory(p, c);
    expect(failureLine(container)?.textContent).toContain(
      "2 checks still fail",
    );
    expect(button(container, "Go live anyway")).toBeUndefined();
  });

  it("Go live anyway waives lint and the TESTS gate then passes", async () => {
    const ops: StudioProductAction[] = [
      ...working,
      actions.recordCheckRun({
        changeId: "c1",
        id: "r1",
        at: at(8),
        results: [
          { kind: "GENERATE", passed: true },
          { kind: "TYPECHECK", passed: true },
          { kind: "LINT", passed: false, reason: "2 unused variables" },
          { kind: "REDUCER_TESTS", passed: true },
          { kind: "SMOKE", passed: true },
        ],
      }),
    ];
    const p = product(...ops);
    const c = chat(idea(), reply("a1", "Only lint is left.", at(8), at(9)));
    // The browser's clock runs behind the agent's: the waiver still covers
    // the lint run.
    const container = renderStory(p, c, {}, new Date(at(7)));
    expect(failureLine(container)?.textContent).toContain(
      "1 check still fails: 2 unused variables",
    );
    expectNoForbiddenWords(container);

    click(button(container, "Go live anyway"));
    await settle();
    const types = hoisted.dispatched.map((d) => [d.id, d.action.type]);
    expect(types).toEqual([
      [PRODUCT_ID, "WAIVE_LINT"],
      [PRODUCT_ID, "COMPLETE_STEP"],
      [SESSION_ID, "ADD_USER_MESSAGE"],
    ]);
    const waive = hoisted.dispatched[0].action.input;
    expect(waive.changeId).toBe("c1");
    expect(Date.parse(String(waive.at))).toBeGreaterThanOrEqual(
      Date.parse(at(8)),
    );

    const productActions = hoisted.dispatched
      .filter((d) => d.id === PRODUCT_ID)
      .map((d) => d.action as unknown as StudioProductAction);
    const before = productDoc(...buildingOps(), ...ops);
    const after = productActions.reduce((d, a) => reducer(d, a), before);
    const added = after.operations.global.slice(
      before.operations.global.length,
    );
    expect(added.map((o) => o.error ?? null)).toEqual([null, null]);
    const tests = after.state.global.changes[0].steps.find(
      (s) => s.kind === "TESTS",
    );
    expect(tests?.status).toBe("DONE");
  });

  it("the Studio restarting says it is back in a moment", () => {
    const p = product(...working);
    const c = chat(idea(), failed("a1", "u0", at(3)));
    const container = renderStory(p, c, { studioRestarting: true });
    expect(failureLine(container)?.textContent).toBe(RESTARTING_TEXT);
    expect(failureLine(container)?.querySelector("button")).toBeNull();
    // All steps keep their last state while the Studio restarts.
    expect(stripIcon(p, c, null, true).DATA).toBe("◐");
    expectNoForbiddenWords(container);
  });

  it("signed out: a sign-in dialog over the page", () => {
    const onSignIn = vi.fn();
    const container = render(<SignInModal onSignIn={onSignIn} />);
    expect(container.querySelector("[role=dialog]")?.textContent).toContain(
      SIGNED_OUT_TITLE,
    );
    expectNoForbiddenWords(container);
    click(button(container, "Sign in"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("nothing wrong, no failure line", () => {
    const p = product(...working);
    const c = chat(idea(), reply("a1", "Working.", at(2)));
    const container = renderStory(p, c);
    expect(failureLine(container)).toBeNull();
  });

  it("the Studio counts as restarting only after it answered and then missed twice", () => {
    const never = nextWatch(nextWatch(INITIAL_WATCH, false), false);
    expect(isRestarting(never)).toBe(false);
    const once = nextWatch(nextWatch(INITIAL_WATCH, true), false);
    expect(isRestarting(once)).toBe(false);
    const twice = nextWatch(once, false);
    expect(isRestarting(twice)).toBe(true);
    expect(isRestarting(nextWatch(twice, true))).toBe(false);
  });
});

describe("the live product's failure rows (spec §5.6–§5.9)", () => {
  /** The live rows with the real handlers bound to PRODUCT_ID. */
  function LiveRows({
    p,
    publish = null,
    allowPublish = () => Promise.resolve(true),
  }: {
    p: ReturnType<typeof product>;
    publish?: { state: "GRANTED" | "MISSING" | "EXPIRED" | "UNKNOWN" } | null;
    allowPublish?: () => Promise<boolean>;
  }) {
    const handlers = useFailureHandlers({
      sessionId: null,
      productId: PRODUCT_ID,
      product: p,
      requestedBy: "Frank",
      allowPublish,
      focusSteer: () => {},
      requestBudget: () => {},
      restartPreview: () => Promise.resolve(),
    });
    const failure = failureFor(
      p,
      null,
      null,
      { studioRestarting: false, publish },
      { now: new Date(at(45)), handlers },
    );
    return failure ? <FailureLine failure={failure} /> : <span>all well</span>;
  }

  function liveFailure(
    p: ReturnType<typeof product>,
    publish: {
      state: "GRANTED" | "MISSING" | "EXPIRED" | "UNKNOWN";
    } | null = null,
  ) {
    return failureFor(
      p,
      null,
      null,
      { studioRestarting: false, publish },
      { now: new Date(at(45)) },
    );
  }

  function liveStrip(
    p: ReturnType<typeof product>,
    publish: {
      state: "GRANTED" | "MISSING" | "EXPIRED" | "UNKNOWN";
    } | null = null,
  ) {
    const view = withFailure(
      stripModel(p, {
        budget: null,
        averages: PHASE_AVERAGES,
        now: new Date(at(45)),
      }),
      liveFailure(p, publish),
    );
    return {
      ...Object.fromEntries(view.steps.map((s) => [s.kind, s.icon])),
      CHANGE: view.change?.icon,
    };
  }

  it("launch failure says the live app is still on the previous version", () => {
    const p = readProduct(
      withFailedLaunch(withLiveVersion(productDoc(...buildingOps()))).state
        .global,
    );
    const failure = liveFailure(p);
    expect(failure?.situation).toBe("launch-failed");
    expect(failure?.text).toBe(
      "Couldn't go live: the new version didn't start. Your live app is still on Version 1.",
    );
    // The failed change is open again (READY): its line carries the ✕,
    // the live version keeps ● Live.
    expect(liveStrip(p)).toMatchObject({ CHANGE: "✕", LIVE: "●" });

    const container = render(<LiveRows p={p} />);
    expect(container.textContent).toContain(
      "Your live app is still on Version 1.",
    );
    expectNoForbiddenWords(container);
  });

  it("a first launch that failed says the app isn't live yet", () => {
    const p = readProduct(
      withFailedLaunch(productDoc(...buildingOps())).state.global,
    );
    expect(liveFailure(p)?.text).toBe(
      "Couldn't go live: the new version didn't start. Your app isn't live yet.",
    );
  });

  it("Try again asks for a new launch; Ask the agent to fix it writes into the failed change's conversation", async () => {
    const p = readProduct(
      withFailedLaunch(withLiveVersion(productDoc(...buildingOps()))).state
        .global,
    );
    const container = render(<LiveRows p={p} />);

    click(button(container, "Try again"));
    await settle();
    expect(hoisted.dispatched).toMatchObject([
      {
        action: {
          type: "REQUEST_LAUNCH",
          input: { changeId: "c1", requestedBy: "Frank" },
        },
        id: PRODUCT_ID,
      },
    ]);

    hoisted.dispatched = [];
    click(button(container, ASK_AGENT_TO_FIX));
    await settle();
    expect(hoisted.dispatched.map((d) => [d.id, d.action.type])).toEqual([
      [SESSION_ID, "ADD_USER_MESSAGE"],
    ]);
    const message = JSON.stringify(hoisted.dispatched[0].action.input);
    expect(message).toContain(
      "The last launch failed: the new version didn't start.",
    );
  });

  it("permission needs you: Allow runs the owner's OK", async () => {
    const doc = withLiveVersion(productDoc(...buildingOps()), { number: 2 });
    const launching = {
      ...doc.state.global.versions.at(-1)!,
      number: 3,
      status: "LAUNCHING" as const,
      launchedAt: null,
    };
    doc.state.global.versions = [...doc.state.global.versions, launching];
    doc.state.global.changes[0].status = "LAUNCHING";
    const p = readProduct(doc.state.global);

    const failure = liveFailure(p, { state: "MISSING" });
    expect(failure?.situation).toBe("permission");
    expect(failure?.text).toBe(PERMISSION_NEEDED);
    expect(liveStrip(p, { state: "MISSING" })).toMatchObject({
      CHANGE: "!",
      LIVE: "●",
    });

    const allowPublish = vi.fn(() => Promise.resolve(true));
    const container = render(
      <LiveRows
        p={p}
        publish={{ state: "MISSING" }}
        allowPublish={allowPublish}
      />,
    );
    expect(container.textContent).toContain(
      "Your Studio needs your OK to publish.",
    );
    click(button(container, "Allow"));
    await settle();
    expect(allowPublish).toHaveBeenCalledTimes(1);
  });

  it("health banner actions: Restart, or go back to the version before", async () => {
    const doc = withLiveVersion(productDoc(...buildingOps()), { number: 3 });
    doc.state.global.health = "UNHEALTHY";
    const p = readProduct(doc.state.global);

    const failure = liveFailure(p);
    expect(failure?.situation).toBe("live-unhealthy");
    expect(failure?.text).toBe(LIVE_UNHEALTHY);
    // The Live step turns amber, with its state in words.
    const view = stripModel(p, {
      budget: null,
      averages: PHASE_AVERAGES,
      now: new Date(at(45)),
    });
    expect(view.steps.find((s) => s.kind === "LIVE")).toMatchObject({
      icon: "!",
      stateText: "not responding",
    });

    const container = render(<LiveRows p={p} />);
    expect(container.textContent).toContain(LIVE_UNHEALTHY);
    click(button(container, "Restart"));
    await settle();
    expect(hoisted.dispatched.map((d) => [d.id, d.action.type])).toEqual([
      [PRODUCT_ID, "REQUEST_RESTART"],
    ]);

    hoisted.dispatched = [];
    click(button(container, "Go back to Version 2"));
    await settle();
    expect(hoisted.dispatched).toMatchObject([
      {
        action: { type: "REQUEST_ROLLBACK", input: { versionNumber: 2 } },
        id: PRODUCT_ID,
      },
    ]);
    expectNoForbiddenWords(container);
  });

  it("a Go back that failed keeps its plain reason until the live version moves on", () => {
    const doc = withLiveVersion(productDoc(...buildingOps()));
    doc.state.global.lastRequestFailure = {
      kind: "ROLLBACK",
      reason: "Finish or discard your change first.",
      at: at(40),
    };
    const p = readProduct(doc.state.global);
    expect(liveFailure(p)).toMatchObject({
      situation: "request-failed",
      text: "Finish or discard your change first.",
    });

    // A later successful launch moves liveSince past it: the line goes.
    doc.state.global.liveSince = at(41);
    expect(liveFailure(readProduct(doc.state.global))).toBeNull();
  });
});
