/**
 * Build-time failure states (spec §5.9, G4): every failure the customer can
 * hit while the product builds, as one plain line with the actions that move
 * it forward, and the strip step it marks. Pure: `failureFor` reads the
 * product document, the build's conversation, the budget and the Studio's
 * state; the actions call the handlers the caller passes in.
 *
 * Where each failure shows in the story:
 * - `stuck` — the story's own stuck line (StoryPane), never a second one;
 * - `not-delivered` — under the steer message it belongs to;
 * - `breather`, `preview-slow` — in place of the step's "!" line;
 * - everything else — one line at the end of the story (FailureLine).
 */
import type {
  Message,
  TurnFailure,
} from "@powerhousedao/clint-common/document-models/chat-session";
import type {
  Change,
  PermissionState,
  StepKind,
  StudioProductState,
  Version,
} from "document-models/studio-product";
import type { BudgetLevel, BudgetRequestState } from "../budget/budgetStore.js";
import {
  ALLOW,
  ASK_AGENT_TO_FIX,
  LIVE_UNHEALTHY,
  PERMISSION_NEEDED,
  RESTART,
  TRY_AGAIN,
  goBackLabel,
  launchFailedText,
} from "../live/liveCopy.js";
import { checkList, type CheckLine } from "../steps/checkList.js";
import { requestFailureText } from "../versions/versionRows.js";
import {
  agentWorking,
  deliveryOf,
  type StoryChat,
} from "../story/storyModel.js";
import {
  openChange,
  type StepIcon,
  type StripView,
} from "../strip/stripModel.js";

/* ---------- copy (exact, spec §5.9) ---------- */

export const RETRIED_TEXT = "⟲ retried once on a backup model";
export const TURN_FAILED_TEXT =
  "Stopped: the AI service didn't respond. Nothing you built is lost.";
export const BREATHER_TEXT = "Taking a breather";
export const BUDGET_WARNING_TEXT = "You've used 80% of this month's budget.";
export const BUDGET_USED_UP_TEXT = "Budget used up. Your work so far is saved.";
export const NOT_DELIVERED_TEXT = "Not delivered yet";
export const PREVIEW_SLOW_TEXT = "The preview is taking longer than usual.";
export const RESTARTING_TEXT = "Your Studio is restarting — back in a moment.";
export const RESTART_FAILED_TEXT = "Couldn't restart the preview.";

/** Copies of the supervisor's step reasons and continue message
 *  (vetra-cli `src/product/supervisor-rules.ts`: `BREATHER_REASON`,
 *  `PREVIEW_SLOW_REASON`, `CONTINUE_TEXT`); vetra-app can't import vetra-cli.
 *  Keep them equal — vetra-cli `tests/product/supervisor-rules.test.ts`
 *  checks this file for the same strings. */
export const SUPERVISOR_BREATHER_REASON = "Taking a breather";
export const SUPERVISOR_PREVIEW_SLOW_REASON =
  "The preview is taking longer than usual.";

/** The supervisor's continue message (see above). */
export const CONTINUE_MESSAGE = "continue";
export const TRY_AGAIN_MESSAGE =
  "Some checks still fail. Please try again to make them pass.";
export const GO_LIVE_ANYWAY_MESSAGE =
  "Go live anyway: the lint findings are fine as they are. Carry on.";
export const SIMPLER_MESSAGE = "Try a simpler version.";
export const SKIP_MESSAGE = "Skip this part for now.";

/** A turn failure code that means the budget ran out (chat bridge). */
const BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED";
/** A turn stopped by Pause (Task 1.2's PauseProcessor aborts with reason
 *  `paused`; the bridge writes it as the code or the finish reason). */
const PAUSED_CODE = "PAUSED";
const PAUSED_FINISH_REASON = "paused";
/** Partial assistant messages a retried turn moved past (chat bridge). */
const RETRY_FINISH_REASON = "retry";

/* ---------- types ---------- */

export type FailureSituation =
  | "restarting"
  | "budget-used-up"
  | "turn-failed"
  | "stuck"
  | "preview-slow"
  | "breather"
  | "checks-failing"
  | "not-delivered"
  | "budget-warning"
  | "retried"
  | "permission"
  | "launch-failed"
  | "live-unhealthy"
  | "request-failed";

export type FailureAction = {
  label: string;
  /** May reject with a plain message the line then shows. */
  run: () => void | Promise<void>;
};

export type Failure = {
  situation: FailureSituation;
  /** The strip step the failure marks; none when the strip is unchanged. */
  stripStep?: StepKind;
  stripIcon?: Extract<StepIcon, "!" | "✕">;
  text: string;
  /** One line each: what the agent tried, which checks fail. */
  detail?: string[];
  actions: FailureAction[];
  /** `not-delivered`: the message it belongs to. */
  messageId?: string;
  /** `not-delivered`: shown under its steer line (not for the idea). */
  underMessage?: boolean;
  /** `budget-used-up`: the request's state for "Request more budget". */
  budgetRequest?: BudgetRequestState;
  /** Small, informational (the retried line). */
  small?: boolean;
};

/** What the actions do; the shell binds them to the documents. */
export type FailureHandlers = {
  /** RETRY_TURN on the conversation. */
  retryTurn: (userMessageId: string) => void | Promise<void>;
  /** A customer message in the conversation. */
  send: (text: string) => void | Promise<void>;
  /** Focuses the steer box ("Continue" / "Tell me how"). */
  focusSteer: () => void;
  /** Breather: the step back to WORKING and `continue` to the agent. */
  continueBuild: (changeId: string, kind: StepKind) => void | Promise<void>;
  /** WAIVE_LINT, then COMPLETE_STEP TESTS. */
  waiveLint: (changeId: string, at: string) => void | Promise<void>;
  requestBudget: () => void;
  /** Rejects with "Couldn't restart the preview." */
  restartPreview: () => Promise<void>;
  /** The owner's OK to publish (`usePublishPermission().allow`). */
  allowPublish: () => void | Promise<boolean>;
  /** REQUEST_LAUNCH on a change that is READY after a failed launch (F10). */
  requestLaunch: (changeId: string) => void | Promise<void>;
  /** REQUEST_RESTART: the agent re-deploys the live version (F15). */
  requestRestart: () => void | Promise<void>;
  /** REQUEST_ROLLBACK to a version that was live before. */
  requestRollback: (versionNumber: number) => void | Promise<void>;
  /** The failure, as a message into the failed change's own conversation. */
  askAgentToFix: (changeId: string, reason: string) => void | Promise<void>;
};

export const NO_HANDLERS: FailureHandlers = {
  retryTurn: () => {},
  send: () => {},
  focusSteer: () => {},
  continueBuild: () => {},
  waiveLint: () => {},
  requestBudget: () => {},
  restartPreview: () => Promise.resolve(),
  allowPublish: () => {},
  requestLaunch: () => {},
  requestRestart: () => {},
  requestRollback: () => {},
  askAgentToFix: () => {},
};

/** The budget as the failures read it. */
export type FailureBudget = {
  level: BudgetLevel;
  request: BudgetRequestState;
} | null;

/** The Studio itself (its daemon), as the failures read it. */
export type FailurePreview = {
  /** The Studio was up and stopped answering (upgrade, out of memory). */
  studioRestarting: boolean;
  /** The owner's publishing permission, as `usePublishPermission` reads it
   *  (Task 2.8); null while the product document isn't loaded. */
  publish?: { state: PermissionState } | null;
};

/* ---------- helpers ---------- */

function time(iso: string | null | undefined): number {
  const parsed = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The step a failure of the whole build marks: the working one, else the
 *  first step not done yet (Live aside). */
export function activeStep(change: Change): StepKind | null {
  const working = change.steps.find((s) => s.status === "WORKING");
  if (working) return working.kind;
  return (
    change.steps.find((s) => s.status !== "DONE" && s.kind !== "LIVE")?.kind ??
    null
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "I'm stuck on <reason>. I tried <n> ways." — the agent's reason kept
 *  when it already says it is stuck. */
export function stuckText(reason: string, tried: readonly string[]): string {
  const trimmed = reason.trim();
  const said = /^i['’]?m stuck\b/i.test(trimmed)
    ? /[.!?]$/.test(trimmed)
      ? trimmed
      : `${trimmed}.`
    : `I'm stuck on ${trimmed.replace(/[.!?]+$/, "")}.`;
  return tried.length > 0
    ? `${said} I tried ${plural(tried.length, "way", "ways")}.`
    : said;
}

/** The latest turn's failure, unless a retry is on its way or the turn was
 *  stopped by Pause (F16: a pause is not a failure). */
function turnFailure(
  change: Change,
  chat: StoryChat | null,
): TurnFailure | null {
  const last = chat?.messages.at(-1);
  if (!last || last.role !== "ASSISTANT" || !last.failure) return null;
  if (chat?.retryRequestedFor) return null;
  if (change.status === "PAUSED") return null;
  if (
    last.failure.code === PAUSED_CODE ||
    last.finishReason === PAUSED_FINISH_REASON
  ) {
    return null;
  }
  return last.failure;
}

/** The newest message the agent hasn't picked up after 60 s; `idea` when
 *  it is the first one (the story shows it as the idea, not a steer line). */
function notDeliveredMessage(
  chat: StoryChat | null,
  now: Date,
): { message: Message; idea: boolean } | null {
  const messages = chat?.messages ?? [];
  const firstUser = messages.findIndex((m) => m.role === "USER");
  for (let i = messages.length - 1; i >= 0 && firstUser >= 0; i--) {
    if (messages[i].role !== "USER") continue;
    if (deliveryOf(messages, i, now) === "not-delivered") {
      return { message: messages[i], idea: i === firstUser };
    }
  }
  return null;
}

/** Partial messages the current turn retried past (fallback model). */
function retriesInTurn(chat: StoryChat | null): number {
  const messages = chat?.messages ?? [];
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "USER") break;
    if (m.role === "ASSISTANT" && m.finishReason === RETRY_FINISH_REASON) {
      count += 1;
    }
  }
  return count;
}

/** The latest LINT run's time, so a waiver is never older than it (the
 *  browser's clock may run behind the agent's). */
function latestLintAt(change: Change): string | null {
  let best: string | null = null;
  for (const run of change.checkRuns) {
    if (!run.results.some((r) => r.kind === "LINT")) continue;
    if (best === null || time(run.at) >= time(best)) best = run.at;
  }
  return best;
}

/** The "Not delivered yet · Retry" failure for one steer message. */
export function notDeliveredFailure(
  messageId: string,
  handlers: FailureHandlers,
  underMessage = true,
): Failure {
  return {
    situation: "not-delivered",
    text: NOT_DELIVERED_TEXT,
    messageId,
    underMessage,
    actions: [{ label: "Retry", run: () => handlers.retryTurn(messageId) }],
  };
}

/* ---------- the live product (state 2, spec §5.6–§5.9) ---------- */

/** The newest version whose launch failed and that no later version replaced. */
function failedVersion(product: StudioProductState): Version | null {
  const live = product.liveVersion;
  const failed = product.versions.filter(
    (v) =>
      v.status === "FAILED" &&
      v.failure !== null &&
      (live === undefined || live === null || v.number > live),
  );
  return failed.sort((a, b) => b.number - a.number)[0] ?? null;
}

/** A launch that failed: try it again, or hand the reason to the agent (F15). */
function launchFailure(
  product: StudioProductState,
  handlers: FailureHandlers,
): Failure | null {
  const failed = failedVersion(product);
  // A retry is on its way: the version is LAUNCHING and the lines show it.
  if (!failed || product.versions.some((v) => v.status === "LAUNCHING")) {
    return null;
  }
  const reason = failed.failure ?? "";
  const changeId = failed.changeId;
  const actions: FailureAction[] = [];
  if (changeId) {
    // F10: FAIL_LAUNCH puts the change back to READY, so a launch applies.
    actions.push({
      label: TRY_AGAIN,
      run: () => handlers.requestLaunch(changeId),
    });
    actions.push({
      label: ASK_AGENT_TO_FIX,
      run: () => handlers.askAgentToFix(changeId, reason),
    });
  }
  return {
    situation: "launch-failed",
    stripStep: "LIVE",
    stripIcon: "✕",
    text: launchFailedText(reason, product.liveVersion ?? null),
    actions,
  };
}

/** The owner's OK ran out while a launch waits for it (Task 2.8, D7). */
function permissionFailure(
  product: StudioProductState,
  preview: FailurePreview,
  handlers: FailureHandlers,
): Failure | null {
  const state = preview.publish?.state;
  if (state !== "MISSING" && state !== "EXPIRED") return null;
  const launching = product.versions.some((v) => v.status === "LAUNCHING");
  const change = openChange(product);
  const waiting =
    launching || change?.status === "READY" || change?.status === "LAUNCHING";
  if (!waiting) return null;
  return {
    situation: "permission",
    stripStep: "LIVE",
    stripIcon: "!",
    text: PERMISSION_NEEDED,
    actions: [
      {
        label: ALLOW,
        run: () => {
          void handlers.allowPublish();
        },
      },
    ],
  };
}

/** The live app stopped answering (Task 2.10's `health`): restart it, or go
 *  back to the version before it. */
function unhealthyLive(
  product: StudioProductState,
  handlers: FailureHandlers,
): Failure | null {
  const live = product.liveVersion;
  if (live === undefined || live === null) return null;
  if (product.health !== "UNHEALTHY") return null;
  const actions: FailureAction[] = [
    { label: RESTART, run: () => handlers.requestRestart() },
  ];
  // F26: a version the data can't go back to never gets a plain Go back.
  const before = product.versions.find((v) => v.number === live - 1);
  if (live > 1 && !before?.rollbackBlockedReason) {
    actions.push({
      label: goBackLabel(live - 1),
      run: () => handlers.requestRollback(live - 1),
    });
  }
  return { situation: "live-unhealthy", text: LIVE_UNHEALTHY, actions };
}

/** A Go back / Restart / Discard the agent couldn't carry out (X28): the
 *  plain reason stays visible until the live version moves on. */
function requestFailure(product: StudioProductState): Failure | null {
  const failed = product.lastRequestFailure;
  if (!failed) return null;
  if (time(failed.at) <= time(product.liveSince)) return null;
  return {
    situation: "request-failed",
    text: requestFailureText(failed),
    actions: [],
  };
}

/** What is wrong with the live product now, the most pressing first. */
function liveFailure(
  product: StudioProductState,
  handlers: FailureHandlers,
): Failure | null {
  return (
    launchFailure(product, handlers) ??
    unhealthyLive(product, handlers) ??
    requestFailure(product)
  );
}

/* ---------- the failure ---------- */

export type FailureOptions = {
  now: Date;
  handlers?: FailureHandlers;
};

/**
 * The failure to show for the build now, the most pressing first; null
 * when nothing is wrong. `product` is the normalised product state.
 */
export function failureFor(
  product: StudioProductState | null,
  chat: StoryChat | null,
  budget: FailureBudget,
  preview: FailurePreview,
  { now, handlers = NO_HANDLERS }: FailureOptions,
): Failure | null {
  if (preview.studioRestarting) {
    return { situation: "restarting", text: RESTARTING_TEXT, actions: [] };
  }
  const permission = product
    ? permissionFailure(product, preview, handlers)
    : null;
  if (permission) return permission;
  const change = product ? openChange(product) : null;
  if (!product) return null;
  if (!change || (change.status !== "BUILDING" && change.status !== "PAUSED")) {
    return liveFailure(product, handlers);
  }
  const step = activeStep(change) ?? undefined;
  const failed = turnFailure(change, chat);

  if (budget?.level === "exhausted" || failed?.code === BUDGET_EXHAUSTED) {
    return {
      situation: "budget-used-up",
      stripStep: step,
      stripIcon: "!",
      text: BUDGET_USED_UP_TEXT,
      budgetRequest: budget?.request ?? { kind: "idle" },
      actions: [
        { label: "Request more budget", run: () => handlers.requestBudget() },
      ],
    };
  }

  if (failed) {
    const userMessageId = failed.userMessageId;
    return {
      situation: "turn-failed",
      stripStep: step,
      stripIcon: "✕",
      text: TURN_FAILED_TEXT,
      actions: [
        { label: "Retry", run: () => handlers.retryTurn(userMessageId) },
        { label: "Continue", run: () => handlers.focusSteer() },
      ],
    };
  }

  if (change.stuck) {
    return {
      situation: "stuck",
      stripStep: step,
      stripIcon: "!",
      text: stuckText(change.stuck.reason, change.stuck.tried),
      detail: [...change.stuck.tried],
      actions: [
        {
          label: "Try a simpler version",
          run: () => handlers.send(SIMPLER_MESSAGE),
        },
        { label: "Skip this part", run: () => handlers.send(SKIP_MESSAGE) },
        { label: "Tell me how", run: () => handlers.focusSteer() },
      ],
    };
  }

  const editors = change.steps.find((s) => s.kind === "EDITORS");
  if (
    editors?.status === "NEEDS_YOU" &&
    editors.reason === SUPERVISOR_PREVIEW_SLOW_REASON
  ) {
    return {
      situation: "preview-slow",
      stripStep: "EDITORS",
      stripIcon: "!",
      text: PREVIEW_SLOW_TEXT,
      actions: [
        {
          label: "Restart preview",
          run: () =>
            handlers.restartPreview().catch(() => {
              throw new Error(RESTART_FAILED_TEXT);
            }),
        },
      ],
    };
  }

  const breather = change.steps.find(
    (s) => s.status === "NEEDS_YOU" && s.reason === SUPERVISOR_BREATHER_REASON,
  );
  if (breather) {
    const changeId = change.id;
    return {
      situation: "breather",
      stripStep: breather.kind,
      stripIcon: "!",
      text: BREATHER_TEXT,
      actions: [
        {
          label: "Continue",
          run: () => handlers.continueBuild(changeId, breather.kind),
        },
      ],
    };
  }

  const checks = checksFailing(change, chat, handlers, now);
  if (checks) return checks;

  const pending = notDeliveredMessage(chat, now);
  if (pending) {
    return notDeliveredFailure(pending.message.id, handlers, !pending.idea);
  }

  if (budget?.level === "warning") {
    return {
      situation: "budget-warning",
      text: BUDGET_WARNING_TEXT,
      actions: [],
    };
  }

  const retries = retriesInTurn(chat);
  if (retries > 0) {
    return {
      situation: "retried",
      text:
        retries === 1
          ? RETRIED_TEXT
          : `⟲ retried ${retries} times on a backup model`,
      small: true,
      actions: [],
    };
  }
  return null;
}

/** Waiving lint would let the TESTS gate pass: lint is the only failure,
 *  every other check passed, and the type check and preview check are not
 *  older than the latest code generation (the reducer's gate). */
function lintOnlyBlocksTests(checks: readonly CheckLine[]): boolean {
  const generatedAt = time(checks.find((c) => c.kind === "GENERATE")?.at);
  return checks.every((c) => {
    if (c.kind === "LINT") return c.status === "failed";
    if (c.status !== "passed") return false;
    if (c.kind === "TYPECHECK" || c.kind === "SMOKE") {
      return time(c.at) >= generatedAt;
    }
    return true;
  });
}

/** Checks keep failing and the agent gave up (its turn ended, the Tests
 *  step isn't done): "2 checks still fail: …". "Go live anyway" only when
 *  every failing check is the lint check (F14) — never type or test failures. */
function checksFailing(
  change: Change,
  chat: StoryChat | null,
  handlers: FailureHandlers,
  now: Date,
): Failure | null {
  if (change.status !== "BUILDING") return null;
  const tests = change.steps.find((s) => s.kind === "TESTS");
  if (tests?.status === "DONE") return null;
  const checks = checkList(change);
  const failing = checks.filter((c) => c.status === "failed");
  if (failing.length === 0) return null;
  // Still on it (or about to be): the agent is working, or was just asked.
  if (agentWorking(chat)) return null;
  const last = chat?.messages.at(-1);
  if (!last || last.role === "USER") return null;

  const reasons = failing.map((c) => c.reason ?? c.label);
  const count = failing.length;
  const changeId = change.id;
  const actions: FailureAction[] = [
    {
      label: "Let the agent try again",
      run: () => handlers.send(TRY_AGAIN_MESSAGE),
    },
  ];
  if (lintOnlyBlocksTests(checks)) {
    actions.push({
      label: "Go live anyway",
      run: () => {
        const lintAt = latestLintAt(change);
        const at =
          lintAt && time(lintAt) > now.getTime() ? lintAt : now.toISOString();
        return handlers.waiveLint(changeId, at);
      },
    });
  }
  return {
    situation: "checks-failing",
    stripStep: "TESTS",
    stripIcon: "✕",
    text: `${count} ${count === 1 ? "check still fails" : "checks still fail"}: ${reasons.join("; ")}`,
    detail: [],
    actions,
  };
}

/** The strip with the failure's step marked (`!` needs you, `✕` stopped). */
export function withFailure(
  view: StripView,
  failure: Failure | null,
): StripView {
  if (!failure?.stripStep || !failure.stripIcon) return view;
  const { stripStep, stripIcon } = failure;
  return {
    ...view,
    steps: view.steps.map((step) =>
      step.kind === stripStep
        ? {
            ...step,
            icon: stripIcon,
            status: stripIcon === "✕" ? "STOPPED" : "NEEDS_YOU",
            stateText: stripIcon === "✕" ? "stopped" : "needs you",
            count: undefined,
            clickable: true,
          }
        : step,
    ),
  };
}

/** Failures shown in place of another story line, not at the end. */
export function shownInline(failure: Failure): boolean {
  return (
    failure.situation === "stuck" ||
    (failure.situation === "not-delivered" && failure.underMessage !== false) ||
    failure.situation === "breather" ||
    failure.situation === "preview-slow"
  );
}
