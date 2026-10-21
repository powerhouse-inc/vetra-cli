/**
 * Supervisor rules (spec §5.9): what the Studio does on its own when a build
 * stalls, hits the step cap, or the preview won't start, plus the build
 * metrics. Pure — reads the product state, the active change's chat session
 * and the clock, returns what to do; `supervisor.ts` carries it out.
 *
 * - `markStuck` — the turn runs, no tool is running and nothing moved for
 *   5 min (no milestone, no finished step, no new turn); or the same check
 *   kind failed in its last 3 runs. Never while the change is already stuck,
 *   and never within 5 min of the last milestone (F38: recovery clears
 *   `stuck` in the reducer, the supervisor never dispatches CLEAR_STUCK).
 * - `autoContinue` — the turn ended at the step cap with the change still
 *   BUILDING: add the milestone "Taking a breather — continuing." and send
 *   `continue` once. When the capped turn was itself that
 *   `continue`, ask instead (`stepAttention` NEEDS_YOU "Taking a breather").
 * - `previewSlow` — 60 s after the latest preview start the preview is not up
 *   and no SMOKE ran since: Editors NEEDS_YOU. `previewRecovered` puts Editors
 *   back to WORKING once the preview is up.
 * - `recordMetrics` — steps, first preview, ready time, when they changed.
 *
 * Every action carries a `key`; the supervisor carries out a key once.
 */
import type {
  Change,
  CheckKind,
  CheckRun,
  StepKind,
  StudioProductState,
} from "vetra-app/document-models/studio-product";
import type {
  ChatSessionState,
  Message,
} from "@powerhousedao/clint-common/document-models/chat-session";
import { capReason } from "./check-results.js";

export const STUCK_AFTER_MS = 5 * 60_000;
export const STUCK_AFTER_FAILED_RUNS = 3;
export const PREVIEW_SLOW_AFTER_MS = 60_000;
/** The message the supervisor sends to continue a capped turn. */
export const CONTINUE_TEXT = "continue";
export const BREATHER_REASON = "Taking a breather";
/** The story line of an automatic continue (spec §5.9). */
export const BREATHER_MILESTONE = "Taking a breather — continuing.";
export const PREVIEW_SLOW_REASON = "The preview is taking longer than usual.";
/** Finish reasons of a turn the step cap ended (the last step still had tool calls). */
const CAP_FINISH_REASONS = new Set(["tool-calls", "tool_calls"]);
/** A partial message the turn moved past (chat bridge): not the end of the turn. */
const SUPERSEDED_FINISH_REASONS = new Set(["retry", "restart"]);
const PREVIEW_START_TOOLS = new Set(["reactor-project-start", "reactor-project-restart"]);

const CHECK_LABELS: Record<CheckKind, string> = {
  GENERATE: "code generation",
  TYPECHECK: "type check",
  LINT: "code style check",
  REDUCER_TESTS: "tests",
  SMOKE: "preview check",
};

export type SupervisorAction =
  | { type: "markStuck"; key: string; changeId: string; reason: string; tried: string[] }
  | {
      type: "autoContinue";
      key: string;
      changeId: string;
      chatSessionId: string;
      /** Fixed per capped turn, so a repeat is refused as a duplicate. */
      milestoneId: string;
    }
  | {
      type: "stepAttention";
      key: string;
      changeId: string;
      kind: StepKind;
      reason: string;
    }
  | { type: "previewSlow"; key: string; changeId: string }
  | { type: "previewRecovered"; key: string; changeId: string }
  | {
      type: "recordMetrics";
      key: string;
      changeId: string;
      steps: number;
      firstPreviewAt: string | null;
      readyAt: string | null;
    };

/** What the supervisor sees outside the documents. */
export interface SupervisorObservations {
  /** The id of `chat` (the active change's chat session). */
  chatSessionId?: string;
  /** The preview (reactor project) is up; undefined when unknown. */
  previewReady?: boolean;
}

const OPEN = new Set(["BUILDING", "PAUSED", "READY", "LAUNCHING"]);

function ms(iso: string | null | undefined): number {
  if (!iso) return -Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
}

function iso(t: number): string | null {
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function activeChange(state: StudioProductState): Change | null {
  if (!state.activeChangeId) return null;
  return state.changes.find((c) => c.id === state.activeChangeId) ?? null;
}

/* ---------- chat ---------- */

export interface Turn {
  /** The user message this turn answers. */
  userMessage: Message | null;
  /** When the agent started on it (pickup, else the first output). */
  startedAt: number;
  running: boolean;
  /** The message that ended the turn, when it ended normally. */
  ended: Message | null;
  /** A tool call of this turn has no result yet. */
  toolRunning: boolean;
}

function isFailed(m: Message): boolean {
  return m.role === "ASSISTANT" && !!m.failure;
}

function isEnd(m: Message): boolean {
  return (
    m.role === "ASSISTANT" &&
    !m.failure &&
    !!m.finishedAt &&
    !SUPERSEDED_FINISH_REASONS.has(m.finishReason ?? "")
  );
}

/** The latest turn of the chat, or null when there is none. */
export function latestTurn(chat: ChatSessionState): Turn | null {
  const messages = chat.messages;
  let anchor = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "USER" || isFailed(messages[i])) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) return null;
  const head = messages[anchor];
  const segment = messages.slice(anchor + 1);
  const userMessage =
    head.role === "USER"
      ? head
      : (messages.find((m) => m.id === head.failure?.userMessageId && m.role === "USER") ?? null);
  const ended = segment.find(isEnd) ?? null;
  const output = segment.some((m) => m.role === "ASSISTANT" || m.role === "TOOL");
  const running =
    !chat.interruptRequested &&
    !ended &&
    (head.role === "USER" ? !!head.pickedUpAt : output);
  const results = new Set<string>();
  for (const m of segment) {
    for (const p of m.content) {
      if (p.type === "TOOL_RESULT" && p.toolCallId) results.add(p.toolCallId);
    }
  }
  const toolRunning = segment.some(
    (m) =>
      m.role === "ASSISTANT" &&
      m.content.some((p) => p.type === "TOOL_CALL" && !!p.toolCallId && !results.has(p.toolCallId)),
  );
  const startedAt =
    head.role === "USER"
      ? ms(head.pickedUpAt ?? head.createdAt)
      : ms(segment[0]?.createdAt ?? head.createdAt);
  return { userMessage, startedAt, running, ended, toolRunning };
}

function userText(m: Message | null): string {
  if (!m) return "";
  return m.content
    .filter((p) => p.type === "TEXT")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

/** Agent steps in this change: one assistant message per step (chat bridge). */
export function countSteps(chat: ChatSessionState, since: number): number {
  return chat.messages.filter(
    (m) => m.role === "ASSISTANT" && !m.failure && ms(m.createdAt) >= since,
  ).length;
}

/** The latest preview start/restart call in this change, with its message. */
function latestPreviewStart(
  chat: ChatSessionState,
  since: number,
): { messageId: string; at: number } | null {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.role !== "ASSISTANT" || ms(m.createdAt) < since) continue;
    if (m.content.some((p) => p.type === "TOOL_CALL" && PREVIEW_START_TOOLS.has(p.toolName ?? ""))) {
      return { messageId: m.id, at: ms(m.createdAt) };
    }
  }
  return null;
}

/* ---------- product ---------- */

/** The last time the change visibly moved: a milestone or a finished step. */
function lastProgress(change: Change): number {
  let t = ms(change.startedAt);
  for (const m of change.milestones) t = Math.max(t, ms(m.at));
  for (const s of change.steps) if (s.status === "DONE") t = Math.max(t, ms(s.updatedAt));
  return t;
}

function lastMilestone(change: Change): number {
  return Math.max(-Infinity, ...change.milestones.map((m) => ms(m.at)));
}

function runsByTime(change: Change): CheckRun[] {
  // Stable: a tie keeps the recorded order.
  return change.checkRuns
    .map((run, i) => ({ run, i }))
    .sort((a, b) => ms(a.run.at) - ms(b.run.at) || a.i - b.i)
    .map(({ run }) => run);
}

/** The kind whose last 3 runs all failed, with those results (oldest first). */
function failingStreak(
  change: Change,
): { kind: CheckKind; runs: CheckRun[]; reasons: Array<string | null> } | null {
  const runs = runsByTime(change);
  const kinds: CheckKind[] = ["GENERATE", "TYPECHECK", "LINT", "REDUCER_TESTS", "SMOKE"];
  for (const kind of kinds) {
    const withKind = runs.filter((r) => r.results.some((x) => x.kind === kind));
    const last = withKind.slice(-STUCK_AFTER_FAILED_RUNS);
    if (last.length < STUCK_AFTER_FAILED_RUNS) continue;
    const results = last.map((r) => r.results.find((x) => x.kind === kind)!);
    if (results.every((x) => !x.passed)) {
      return { kind, runs: last, reasons: results.map((x) => x.reason ?? null) };
    }
  }
  return null;
}

function triedLines(kind: CheckKind, reasons: Array<string | null>): string[] {
  return reasons.map((reason, i) =>
    capReason(`Try ${i + 1}: ${reason ?? `the ${CHECK_LABELS[kind]} failed`}`),
  );
}

/** The step to flag: the first WORKING one, else the first that isn't DONE. */
function currentStep(change: Change): StepKind | null {
  const working = change.steps.find((s) => s.status === "WORKING");
  if (working) return working.kind;
  return change.steps.find((s) => s.status !== "DONE" && s.kind !== "LIVE")?.kind ?? null;
}

function firstPreviewAt(change: Change): string | null {
  let first = Infinity;
  for (const run of change.checkRuns) {
    if (run.results.some((r) => r.kind === "SMOKE" && r.passed)) first = Math.min(first, ms(run.at));
  }
  return iso(first);
}

/** When the change became READY: its last non-LIVE step finishing. */
function readyAt(change: Change, now: Date): string | null {
  if (change.status !== "READY" && change.status !== "LAUNCHING") return null;
  const work = change.steps.filter((s) => s.kind !== "LIVE");
  const t = Math.max(-Infinity, ...work.map((s) => ms(s.updatedAt)));
  return iso(t) ?? now.toISOString();
}

/* ---------- rules ---------- */

function stuckRules(
  change: Change,
  turn: Turn | null,
  now: number,
): SupervisorAction[] {
  if (change.status !== "BUILDING" || change.stuck) return [];
  // F38: never again within 5 min of the last milestone.
  if (now - lastMilestone(change) < STUCK_AFTER_MS) return [];
  const progress = lastProgress(change);

  const streak = failingStreak(change);
  if (streak && ms(streak.runs[0].at) > progress) {
    const label = CHECK_LABELS[streak.kind];
    return [
      {
        type: "markStuck",
        key: `stuck:check:${change.id}:${streak.runs[streak.runs.length - 1].id}`,
        changeId: change.id,
        reason: `I'm stuck: the ${label} failed ${STUCK_AFTER_FAILED_RUNS} times in a row.`,
        tried: triedLines(streak.kind, streak.reasons),
      },
    ];
  }

  if (!turn?.running || turn.toolRunning) return [];
  const since = Math.max(progress, turn.startedAt);
  if (now - since < STUCK_AFTER_MS) return [];
  const step = change.steps.find((s) => s.status === "WORKING");
  const reason = step?.label
    ? `I'm stuck on ${step.label}: nothing has moved for 5 minutes.`
    : "I'm stuck: nothing has moved for 5 minutes.";
  const tried: string[] = [];
  for (const run of runsByTime(change)) {
    if (ms(run.at) < since) continue;
    for (const r of run.results) {
      if (r.passed) continue;
      const line = capReason(r.reason ?? `The ${CHECK_LABELS[r.kind]} failed`);
      if (!tried.includes(line)) tried.push(line);
    }
  }
  return [
    {
      type: "markStuck",
      key: `stuck:idle:${change.id}:${since}`,
      changeId: change.id,
      reason: capReason(reason),
      tried: tried.slice(-3),
    },
  ];
}

function capRules(
  change: Change,
  chat: ChatSessionState,
  turn: Turn | null,
  chatSessionId: string | undefined,
): SupervisorAction[] {
  if (change.status !== "BUILDING" || !turn?.ended || !chatSessionId) return [];
  if (!CAP_FINISH_REASONS.has(turn.ended.finishReason ?? "")) return [];
  // Something was said after the capped turn: it is no longer the latest word.
  const last = chat.messages[chat.messages.length - 1];
  if (last?.role === "USER") return [];
  if (userText(turn.userMessage).toLowerCase() !== CONTINUE_TEXT) {
    return [
      {
        type: "autoContinue",
        key: `continue:${change.id}:${turn.ended.id}`,
        changeId: change.id,
        chatSessionId,
        milestoneId: `breather:${turn.ended.id}`,
      },
    ];
  }
  const kind = currentStep(change);
  if (!kind) return [];
  const step = change.steps.find((s) => s.kind === kind);
  // Already asked about this cap hit (a flag older than it is a past one).
  if (
    step?.status === "NEEDS_YOU" &&
    step.reason === BREATHER_REASON &&
    ms(step.updatedAt) >= ms(turn.ended.finishedAt)
  ) {
    return [];
  }
  return [
    {
      type: "stepAttention",
      key: `breather:${change.id}:${turn.ended.id}`,
      changeId: change.id,
      kind,
      reason: BREATHER_REASON,
    },
  ];
}

function previewRules(
  change: Change,
  chat: ChatSessionState,
  now: number,
  previewReady: boolean | undefined,
): SupervisorAction[] {
  if (change.status !== "BUILDING") return [];
  const editors = change.steps.find((s) => s.kind === "EDITORS");
  if (
    previewReady === true &&
    editors?.status === "NEEDS_YOU" &&
    editors.reason === PREVIEW_SLOW_REASON
  ) {
    return [
      {
        type: "previewRecovered",
        key: `preview-ok:${change.id}:${editors.updatedAt ?? ""}`,
        changeId: change.id,
      },
    ];
  }
  // Unknown preview state: say nothing rather than raise a false alarm.
  if (previewReady !== false) return [];
  if (!editors || editors.status === "DONE" || editors.status === "NEEDS_YOU") return [];
  const start = latestPreviewStart(chat, ms(change.startedAt));
  if (!start || now - start.at < PREVIEW_SLOW_AFTER_MS) return [];
  const smokeSince = change.checkRuns.some(
    (r) => ms(r.at) >= start.at && r.results.some((x) => x.kind === "SMOKE"),
  );
  if (smokeSince) return [];
  return [{ type: "previewSlow", key: `preview:${change.id}:${start.messageId}`, changeId: change.id }];
}

function metricsRules(
  change: Change,
  chat: ChatSessionState | null,
  now: Date,
): SupervisorAction[] {
  const m = change.metrics;
  // The count never goes back (steps already recorded stay counted).
  const steps = Math.max(m.steps, chat ? countSteps(chat, ms(change.startedAt)) : 0);
  const preview = m.firstPreviewAt ?? firstPreviewAt(change);
  const ready = m.readyAt ?? readyAt(change, now);
  if (steps === m.steps && preview === m.firstPreviewAt && ready === m.readyAt) return [];
  return [
    {
      type: "recordMetrics",
      key: `metrics:${change.id}:${steps}:${preview ?? ""}:${ready ?? ""}`,
      changeId: change.id,
      steps,
      firstPreviewAt: preview,
      readyAt: ready,
    },
  ];
}

/**
 * What the supervisor should do now for the active change. `chat` is the
 * change's chat session (null when it has none or it couldn't be read).
 */
export function evaluate(
  state: StudioProductState,
  chat: ChatSessionState | null,
  now: Date,
  observed: SupervisorObservations = {},
): SupervisorAction[] {
  const change = activeChange(state);
  if (!change || !OPEN.has(change.status)) return [];
  const t = now.getTime();
  const turn = chat ? latestTurn(chat) : null;
  const cap = chat ? capRules(change, chat, turn, observed.chatSessionId) : [];
  // An automatic continue moves the build again: not stuck.
  const continuing = cap.some((x) => x.type === "autoContinue");
  return [
    ...(continuing ? [] : stuckRules(change, turn, t)),
    ...cap,
    ...(chat ? previewRules(change, chat, t, observed.previewReady) : []),
    ...metricsRules(change, chat, now),
  ];
}
