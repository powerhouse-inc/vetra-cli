/**
 * After a launch (Ruling F11): the agent normally wrote its suggestions at the
 * end of the Tests step, so nothing more happens. Only when none exist for
 * the new version, and the budget is not used up, the Studio asks the agent
 * for them in one short turn: a Studio note in the change's conversation.
 */
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import { getProductDoc } from "../product/product-doc.js";
import { messageAgent } from "./compat-launch.js";
import type { OrchestratorContext } from "./orchestrator.js";

/** The Studio's failure code for a turn refused because the month's budget is spent. */
export const BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED";
/** A budget failure older than this (e.g. last month's) no longer counts. */
export const BUDGET_FAILURE_RECENT_MS = 24 * 60 * 60 * 1000;

/** What the agent is asked after Version `n` went live without suggestions. */
export function suggestMessage(n: number): string {
  return (
    `Version ${n} is live. Call product-progress suggest with 2–3 small next improvements ` +
    "the customer could ask for (one change each, at most 80 characters, in the customer's words). " +
    "Do nothing else."
  );
}

/** True when the agent already wrote suggestions for Version `n`. */
export function hasSuggestionsFor(state: StudioProductState, n: number): boolean {
  return (state.suggestions ?? []).some((s) => s.afterVersion === n);
}

/** The conversation of the change Version `n` launched (its latest one), or null. */
export function versionChatSession(state: StudioProductState, n: number): string | null {
  const changeId = state.versions.find((v) => v.number === n)?.changeId;
  const change = changeId ? state.changes.find((c) => c.id === changeId) : undefined;
  if (!change) return null;
  return change.chatSessionIds?.at(-1) ?? change.chatSessionId ?? null;
}

interface ChatMessageLike {
  role?: string;
  finishedAt?: string | null;
  failure?: { code?: string; failedAt?: string } | null;
}

/** True when the latest turn of `messages` failed because the budget is used up (recently). */
export function budgetFailedLast(messages: ChatMessageLike[], now: Date): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.failure) {
      const at = Date.parse(m.failure.failedAt ?? "");
      return (
        m.failure.code === BUDGET_EXHAUSTED &&
        Number.isFinite(at) &&
        now.getTime() - at <= BUDGET_FAILURE_RECENT_MS
      );
    }
    if (m.role === "ASSISTANT" && m.finishedAt) return false;
  }
  return false;
}

interface ChatReader {
  get(documentId: string): Promise<unknown>;
}

/**
 * The default budget check: the conversation of the launched change ended on
 * a "budget used up" failure. A conversation that can't be read counts as
 * budget left (the turn itself then fails the usual way).
 */
export async function chatBudgetUsedUp(ctx: OrchestratorContext, n: number): Promise<boolean> {
  const state = (await getProductDoc(ctx))?.state;
  const sessionId = state ? versionChatSession(state, n) : null;
  if (!sessionId) return false;
  const drive = await getEmbeddedDrive(ctx);
  if (!drive) return false;
  try {
    const doc = (await (drive.reactor.client as ChatReader).get(sessionId)) as {
      state?: { global?: { messages?: ChatMessageLike[] } };
    };
    return budgetFailedLast(doc?.state?.global?.messages ?? [], (ctx.now ?? (() => new Date()))());
  } catch {
    return false;
  }
}

/** The default after-launch step: one short turn asking for suggestions. */
export async function askForSuggestions(ctx: OrchestratorContext, n: number): Promise<void> {
  const state = (await getProductDoc(ctx))?.state;
  const sessionId = state ? versionChatSession(state, n) : null;
  if (!sessionId) {
    ctx.log?.info?.(`[launch] Version ${n}: no conversation to ask for suggestions`);
    return;
  }
  const at = (ctx.now ?? (() => new Date()))().toISOString();
  await (ctx.deps?.messageAgent ?? messageAgent)(ctx, sessionId, suggestMessage(n), at);
  ctx.log?.info?.(`[launch] Version ${n}: asked the agent for suggestions`);
}
