/**
 * The build told as a story (spec §5.4, G3): the idea in quotes first, one
 * line per milestone the agent wrote (newest last), the agent's replies as
 * bubbles, the customer's steer messages with their delivery state, and the
 * stuck / needs-you / paused states of the change. Everything the agent did
 * between two milestones (today's chat transcript) is folded under the
 * earlier one as raw detail.
 *
 * Pure: the product state is read, never changed (callers pass the
 * normalised copy from `readProduct`).
 */
import type {
  ChatSessionState,
  ContentPart,
  Message,
} from "@powerhousedao/clint-common/document-models/chat-session";
import type {
  Change,
  CheckKind,
  StepKind,
  StudioProductState,
} from "document-models/studio-product";
import { parseToolValue } from "../tool-renderers/shared/util.js";
import { doingNow, type ToolCallView } from "./doingNow.js";

/** A steer message's delivery (Foundation): sent → seen by the agent. */
export type Delivery = "sent" | "seen" | "not-delivered";

/** Milestone marks: done, in progress, a recovered problem. */
export type MilestoneMark = "✓" | "◐" | "⟲";

/** The chat fields the story reads. */
export type StoryChat = Pick<
  ChatSessionState,
  "messages" | "status" | "interruptRequested"
> &
  Partial<Pick<ChatSessionState, "retryRequestedFor">>;

export type StoryLine =
  | {
      kind: "idea";
      id: string;
      at: string;
      text: string;
      /** Raw detail before the first milestone. */
      detail: Message[];
    }
  | {
      kind: "milestone";
      id: string;
      at: string;
      mark: MilestoneMark;
      text: string;
      /** Raw detail between this milestone and the next. */
      detail: Message[];
      /** The live "doing now" sub-line (only on the active line). */
      doingNow: string | null;
    }
  | { kind: "reply"; id: string; at: string; text: string; question: boolean }
  | { kind: "steer"; id: string; at: string; text: string; delivery: Delivery }
  | { kind: "stuck"; id: string; at: string; reason: string; tried: string[] }
  | { kind: "attention"; id: string; at: string; step: StepKind; text: string }
  | { kind: "paused"; id: string; at: string }
  | {
      kind: "checks";
      id: string;
      at: string;
      /** "Type check ✓ · Lint ✓ · Reducer tests ✕" */
      text: string;
      /** "2 checks failed — fixing"; null when all passed. */
      failed: string | null;
      /** The failures' plain one-line reasons. */
      reasons: string[];
    }
  | { kind: "waiting"; id: string; at: string; text: string };

/** A message not seen by the agent after this long shows "Not delivered yet". */
export const NOT_DELIVERED_AFTER_MS = 60_000;
/** G3: the newest line is at most this old while the agent works. */
export const STALE_AFTER_MS = 30_000;

/** The active step's line when the agent gave it no label. */
const WORKING_TEXT: Record<StepKind, string> = {
  PLAN: "Planning",
  DATA: "Designing the data",
  EDITORS: "Building the screens",
  TESTS: "Running the checks",
  LIVE: "Going live",
};

/** The supervisor's auto-continue after a step-capped turn (vetra-cli
 *  `CONTINUE_TEXT`), or Continue's after a pause; not the customer's words. */
export const AUTO_CONTINUE_TEXT = "continue";
/** Id prefix of the `continue` message the Continue button sends. */
export const CONTINUE_ID_PREFIX = "studio-continue-";
/** Id prefix of the notes the Studio writes to the agent (vetra-cli
 *  `STUDIO_NOTE_ID_PREFIX`, e.g. "make this change additive" after a blocked
 *  launch): not the customer's words, never a story line. */
export const STUDIO_NOTE_ID_PREFIX = "studio-note-";
const CAP_FINISH_REASONS = new Set(["tool-calls", "tool_calls"]);

/** Check names in the story's compact check lines (spec §5.4 Tests step). */
const CHECK_TEXT: Record<CheckKind, string> = {
  GENERATE: "Code generated",
  TYPECHECK: "Type check",
  LINT: "Lint",
  REDUCER_TESTS: "Reducer tests",
  SMOKE: "Preview renders",
};
const CHECK_ORDER: readonly CheckKind[] = [
  "GENERATE",
  "TYPECHECK",
  "LINT",
  "REDUCER_TESTS",
  "SMOKE",
];

/** The text of a message (its TEXT parts). */
export function messageText(message: Message): string {
  return message.content
    .filter((part) => part.type === "TEXT" && part.text)
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

/** Tool results by tool-call id, across a whole conversation. */
export function toolResultsOf(
  messages: readonly Message[],
): Map<string, ContentPart> {
  const results = new Map<string, ContentPart>();
  for (const message of messages) {
    if (message.role !== "TOOL") continue;
    for (const part of message.content) {
      if (part.toolCallId) results.set(part.toolCallId, part);
    }
  }
  return results;
}

function time(iso: string | null | undefined): number {
  const parsed = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function latest(...isos: (string | null | undefined)[]): string {
  let best: string | null = null;
  for (const iso of isos) {
    if (iso && (best === null || time(iso) > time(best))) best = iso;
  }
  return best ?? new Date(0).toISOString();
}

function lastUserIndex(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "USER") return i;
  }
  return -1;
}

/** Seen: the agent marked it picked up, or (older chats) replied after it. */
function pickedUp(messages: readonly Message[], index: number): boolean {
  if (messages[index].pickedUpAt) return true;
  return messages
    .slice(index + 1)
    .some((m) => m.role === "ASSISTANT" || m.role === "TOOL");
}

/** The delivery state of the user message at `index`. */
export function deliveryOf(
  messages: readonly Message[],
  index: number,
  now: Date,
): Delivery {
  if (pickedUp(messages, index)) return "seen";
  const waited = now.getTime() - time(messages[index].createdAt);
  return waited > NOT_DELIVERED_AFTER_MS ? "not-delivered" : "sent";
}

/** The agent is working on a turn right now (mirrors the chat's own view). */
export function agentWorking(chat: StoryChat | null): boolean {
  if (!chat || chat.status !== "ACTIVE" || chat.interruptRequested) {
    return false;
  }
  if (chat.retryRequestedFor) return false;
  const { messages } = chat;
  const lastUser = lastUserIndex(messages);
  if (lastUser === -1 || !pickedUp(messages, lastUser)) return false;
  return !messages
    .slice(lastUser + 1)
    .some((m) => m.failure || (m.role === "ASSISTANT" && m.finishedAt));
}

/** The agent's newest tool call in the current turn. */
export function lastToolCall(chat: StoryChat | null): ToolCallView | null {
  if (!chat) return null;
  const { messages } = chat;
  for (let i = messages.length - 1; i > lastUserIndex(messages); i--) {
    const message = messages[i];
    if (message.role !== "ASSISTANT") continue;
    for (let j = message.content.length - 1; j >= 0; j--) {
      const part = message.content[j];
      if (part.type !== "TOOL_CALL") continue;
      return {
        toolName: part.toolName || "unknown",
        args: parseToolValue(part.args),
      };
    }
  }
  return null;
}

/**
 * A "continue" that isn't the customer's words: the one the Continue button
 * sends (its id), or the supervisor's right after a turn that hit the step
 * cap.
 */
function isAutoContinue(messages: readonly Message[], index: number): boolean {
  const message = messages[index];
  if (messageText(message) !== AUTO_CONTINUE_TEXT) return false;
  if (message.id.startsWith(CONTINUE_ID_PREFIX)) return true;
  for (let i = index - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "USER") return false;
    if (m.role === "ASSISTANT") {
      return CAP_FINISH_REASONS.has(m.finishReason ?? "");
    }
  }
  return false;
}

/** One line per check run: "Type check ✓ · Lint ✓ · …", failures counted
 *  ("2 checks failed — fixing" while the agent still builds). */
function checkLines(change: Change): StoryLine[] {
  const runs = [...change.checkRuns].sort((a, b) => time(a.at) - time(b.at));
  return runs.map((run, i) => {
    const results = [...run.results].sort(
      (a, b) => CHECK_ORDER.indexOf(a.kind) - CHECK_ORDER.indexOf(b.kind),
    );
    const failures = results.filter((r) => !r.passed);
    const count = failures.length;
    // Only the newest run is being fixed; older failures are history.
    const fixing = change.status === "BUILDING" && i === runs.length - 1;
    return {
      kind: "checks",
      id: `checks:${run.id}`,
      at: run.at,
      text: results
        .map((r) => `${CHECK_TEXT[r.kind]} ${r.passed ? "✓" : "✕"}`)
        .join(" · "),
      failed:
        count === 0
          ? null
          : `${count} ${count === 1 ? "check" : "checks"} failed${fixing ? " — fixing" : ""}`,
      reasons: failures.flatMap((r) => (r.reason ? [r.reason] : [])),
    };
  });
}

function ideaText(product: StudioProductState, change: Change): string {
  if (change.kind === "FIRST_BUILD") return product.idea ?? change.request;
  return change.request;
}

/**
 * The story of `change`: chronological lines, the idea first. `now` decides
 * which steer messages are overdue ("Not delivered yet").
 */
export function storyLines(
  product: StudioProductState,
  change: Change,
  chat: StoryChat | null,
  now: Date,
): StoryLine[] {
  const messages = chat?.messages ?? [];
  const firstUser = messages.findIndex((m) => m.role === "USER");
  const working = agentWorking(chat);
  const building = change.status === "BUILDING";

  const idea: Extract<StoryLine, { kind: "idea" }> = {
    kind: "idea",
    id: `idea:${change.id}`,
    at: change.startedAt,
    text: ideaText(product, change),
    detail: [],
  };

  const milestones = [...change.milestones].sort(
    (a, b) => time(a.at) - time(b.at),
  );
  const milestoneLines: Extract<StoryLine, { kind: "milestone" }>[] =
    milestones.map((m) => ({
      kind: "milestone",
      id: m.id,
      at: m.at,
      mark: m.recovered ? "⟲" : "✓",
      text: m.text,
      detail: [],
      doingNow: null,
    }));

  // The line for what's in progress: the working step (or the agent's turn).
  const workingStep = change.steps.find((s) => s.status === "WORKING");
  const active: Extract<StoryLine, { kind: "milestone" }> | null =
    building && (workingStep || working)
      ? {
          kind: "milestone",
          id: `active:${change.id}`,
          at: latest(
            milestones.at(-1)?.at,
            workingStep?.updatedAt,
            change.startedAt,
          ),
          mark: "◐",
          text: workingStep
            ? (workingStep.label ?? WORKING_TEXT[workingStep.kind])
            : "Working on it",
          detail: [],
          doingNow: working ? doingNow(lastToolCall(chat)) : null,
        }
      : null;

  // Fold each message under the line before it.
  for (const [index, message] of messages.entries()) {
    if (index === firstUser) {
      idea.detail.push(message);
      continue;
    }
    const at = time(message.createdAt);
    let owner: { detail: Message[] } = idea;
    for (const line of milestoneLines) {
      if (time(line.at) <= at) owner = line;
    }
    if (active && owner === milestoneLines.at(-1)) owner = active;
    if (active && milestoneLines.length === 0) owner = active;
    owner.detail.push(message);
  }
  if (active) {
    const newest = active.detail.at(-1);
    active.at = latest(active.at, newest?.createdAt, newest?.finishedAt);
  }

  const lines: StoryLine[] = [...milestoneLines, ...checkLines(change)];

  const lastAssistant = messages.findLastIndex(
    (m) => m.role === "ASSISTANT" && messageText(m) !== "",
  );
  for (const [index, message] of messages.entries()) {
    if (message.role === "USER" && index !== firstUser) {
      const text = messageText(message);
      if (!text || message.id.startsWith(STUDIO_NOTE_ID_PREFIX)) continue;
      if (isAutoContinue(messages, index)) continue;
      lines.push({
        kind: "steer",
        id: message.id,
        at: message.createdAt,
        text,
        delivery: deliveryOf(messages, index, now),
      });
    }
    if (message.role === "ASSISTANT") {
      const text = messageText(message);
      if (!text) continue;
      lines.push({
        kind: "reply",
        id: message.id,
        at: message.createdAt,
        text,
        question:
          index === lastAssistant &&
          index > lastUserIndex(messages) &&
          !working &&
          text.endsWith("?"),
      });
    }
  }

  if (change.stuck) {
    lines.push({
      kind: "stuck",
      id: `stuck:${change.id}`,
      at: change.stuck.at,
      reason: change.stuck.reason,
      tried: [...change.stuck.tried],
    });
  }
  for (const step of change.steps) {
    if (step.status !== "NEEDS_YOU" && step.status !== "STOPPED") continue;
    const reason = step.reason ?? "This step needs you.";
    lines.push({
      kind: "attention",
      id: `attention:${change.id}:${step.kind}`,
      at: step.updatedAt ?? change.startedAt,
      step: step.kind,
      text: step.status === "STOPPED" ? `Stopped: ${reason}` : reason,
    });
  }

  // Stable: equal times keep the order above (milestones before replies).
  lines.sort((a, b) => time(a.at) - time(b.at));
  if (active) lines.push(active);
  if (change.status === "PAUSED") {
    lines.push({
      kind: "paused",
      id: `paused:${change.id}`,
      at: latest(...lines.map((l) => l.at), change.startedAt),
    });
  }
  return [idea, ...lines];
}

/** What the agent is up to, for the waiting line. */
export type TurnState = { working: boolean };

/**
 * G3: while the agent works, a line saying it is still on it when the
 * newest line is more than 30 s old; null otherwise.
 */
export function staleness(
  lines: readonly StoryLine[],
  turnState: TurnState,
  now: Date,
): Extract<StoryLine, { kind: "waiting" }> | null {
  if (!turnState.working || lines.length === 0) return null;
  const newest = Math.max(...lines.map((line) => time(line.at)));
  const quiet = now.getTime() - newest;
  if (quiet <= STALE_AFTER_MS) return null;
  return {
    kind: "waiting",
    id: "waiting",
    at: now.toISOString(),
    text: `Still working on it — last update ${ago(quiet)}.`,
  };
}

function ago(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}
