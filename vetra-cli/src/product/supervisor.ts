/**
 * Product supervisor trigger: every few seconds, reads the product document,
 * the active change's chat session and the preview's status, asks the rules
 * (`supervisor-rules.ts`) what to do and does it — mark the change stuck,
 * continue a turn the step cap ended, flag a slow preview, record metrics.
 *
 * Each action is carried out once (by its key) per process: a reducer refusal
 * is final, any other failure is retried on later passes (at most
 * MAX_ATTEMPTS times). A failure is logged and never reaches the agent's turn.
 * A pass runs detached from the shared trigger loop, so a stalled reactor
 * never holds up the other triggers (chat included).
 */
import { randomUUID } from "node:crypto";
import type { Action } from "document-model";
import type { ChatSessionState } from "@powerhousedao/clint-common/document-models/chat-session";
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import { defineTrigger } from "../framework.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import {
  IN_PROGRESS,
  ProductRefusedError,
  activeChange,
  dispatchProduct,
  getProductDoc,
  productActions as a,
  type ProductContext,
} from "./product-doc.js";
import {
  BREATHER_MILESTONE,
  CONTINUE_TEXT,
  PREVIEW_SLOW_REASON,
  evaluate,
  type SupervisorAction,
  type SupervisorObservations,
} from "./supervisor-rules.js";

const TAG = "[product-supervisor]";
/** How often the rules run (the shortest rule threshold is 60 s). */
export const SUPERVISOR_INTERVAL_MS = 10_000;
/** A pass still running after this is logged as slow. */
export const PASS_WARN_MS = 15_000;
/** Tries per action key when the write fails for a reason other than a refusal. */
export const MAX_ATTEMPTS = 3;
const PREVIEW_SERVICE = "reactor-project";

interface Log {
  warn?: (msg: string) => void;
  debug?: (msg: string) => void;
}

interface ServiceList {
  list(name?: string): Array<{ name?: string; status?: string }>;
}

interface ChatClient {
  get(documentId: string): Promise<unknown>;
  execute(documentId: string, branch: string, actions: Action[]): Promise<unknown>;
}

export interface SupervisorDeps {
  ctx: ProductContext;
  services?: ServiceList;
  now?: () => Date;
  log?: Log;
  /** Keys already carried out or given up on (kept across passes by the trigger). */
  done: Set<string>;
  /** Failed tries per key (kept across passes by the trigger). */
  attempts?: Map<string, number>;
}

/** Whether the preview is up; undefined when there is no way to tell. */
function previewReady(services: ServiceList | undefined): boolean | undefined {
  if (!services) return undefined;
  try {
    return services.list(PREVIEW_SERVICE).some((s) => s.status === "ready");
  } catch {
    return undefined;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function chatClient(ctx: ProductContext): Promise<ChatClient | null> {
  const drive = await getEmbeddedDrive(ctx);
  return drive ? drive.reactor.client : null;
}

async function carryOut(
  deps: SupervisorDeps,
  action: SupervisorAction,
  at: string,
): Promise<void> {
  const { ctx } = deps;
  switch (action.type) {
    case "markStuck":
      return dispatchProduct(ctx, [
        a.markStuck({ changeId: action.changeId, reason: action.reason, tried: action.tried, at }),
      ]);
    case "stepAttention":
      return dispatchProduct(ctx, [
        a.setStepAttention({
          changeId: action.changeId,
          kind: action.kind,
          status: "NEEDS_YOU",
          reason: action.reason,
          at,
        }),
      ]);
    case "previewSlow":
      return dispatchProduct(ctx, [
        a.setStepAttention({
          changeId: action.changeId,
          kind: "EDITORS",
          status: "NEEDS_YOU",
          reason: PREVIEW_SLOW_REASON,
          at,
        }),
      ]);
    case "previewRecovered":
      return dispatchProduct(ctx, [
        a.setStepAttention({
          changeId: action.changeId,
          kind: "EDITORS",
          status: "WORKING",
          reason: null,
          at,
        }),
      ]);
    case "recordMetrics":
      return dispatchProduct(ctx, [
        a.recordChangeMetrics({
          changeId: action.changeId,
          steps: action.steps,
          firstPreviewAt: action.firstPreviewAt,
          readyAt: action.readyAt,
        }),
      ]);
    case "autoContinue": {
      const client = await chatClient(ctx);
      if (!client) throw new Error("no reactor to reach the chat");
      await client.execute(action.chatSessionId, "main", [
        chatActions.addUserMessage({
          id: randomUUID(),
          createdAt: at,
          content: [{ id: randomUUID(), type: "TEXT", text: CONTINUE_TEXT }],
        }),
      ]);
      // The story line only once the continue went out: a continue that can't
      // be delivered must not read as progress (it would hold off "stuck").
      // Its id is fixed per capped turn, so a repeat is refused as a duplicate.
      try {
        await dispatchProduct(ctx, [
          a.addMilestone({
            changeId: action.changeId,
            id: action.milestoneId,
            text: BREATHER_MILESTONE,
            at,
          }),
        ]);
      } catch (err) {
        deps.log?.warn?.(`${TAG} breather milestone not added: ${message(err)}`);
      }
      return;
    }
  }
}

/** One supervisor pass; never throws. Returns the actions it carried out. */
export async function supervise(deps: SupervisorDeps): Promise<SupervisorAction[]> {
  const { ctx, log, done } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const carried: SupervisorAction[] = [];
  try {
    const product = await getProductDoc(ctx);
    const change = product ? activeChange(product.state) : null;
    if (!product || !change || !IN_PROGRESS.includes(change.status)) return carried;
    let chat: ChatSessionState | null = null;
    const chatSessionId = change.chatSessionId ?? undefined;
    if (chatSessionId) {
      try {
        const client = await chatClient(ctx);
        const doc = (await client?.get(chatSessionId)) as
          | { state?: { global?: ChatSessionState } }
          | undefined;
        chat = doc?.state?.global ?? null;
      } catch (err) {
        log?.debug?.(`${TAG} could not read chat ${chatSessionId}: ${message(err)}`);
      }
    }
    const observed: SupervisorObservations = {
      chatSessionId,
      previewReady: previewReady(deps.services),
      isDone: (key) => done.has(key),
    };
    const at = now.toISOString();
    const attempts = deps.attempts ?? new Map<string, number>();
    for (const action of evaluate(product.state, chat, now, observed)) {
      if (done.has(action.key)) continue;
      try {
        await carryOut(deps, action, at);
        done.add(action.key);
        attempts.delete(action.key);
        carried.push(action);
      } catch (err) {
        // A refusal won't change on a retry; anything else may be transient.
        const tries = (attempts.get(action.key) ?? 0) + 1;
        attempts.set(action.key, tries);
        if (err instanceof ProductRefusedError || tries >= MAX_ATTEMPTS) {
          done.add(action.key);
          attempts.delete(action.key);
        }
        log?.warn?.(`${TAG} ${action.type} failed (try ${tries}): ${message(err)}`);
      }
    }
  } catch (err) {
    log?.warn?.(`${TAG} pass failed: ${message(err)}`);
  }
  return carried;
}

interface SupervisorState extends Record<string, unknown> {
  lastPassAt: number;
  running: boolean;
  done: Set<string>;
  attempts: Map<string, number>;
}

export const productSupervisorTrigger = defineTrigger<SupervisorState>({
  id: "product-supervisor",
  type: "condition",
  state: () => ({
    lastPassAt: 0,
    running: false,
    done: new Set<string>(),
    attempts: new Map<string, number>(),
  }),

  // Returns at once: the routine loop polls every trigger in turn, so the
  // pass runs detached. `running` keeps passes from overlapping.
  async poll(tctx) {
    const state = tctx.state;
    const nowMs = Date.now();
    if (state.running || nowMs - state.lastPassAt < SUPERVISOR_INTERVAL_MS) return null;
    state.lastPassAt = nowMs;
    const ctx = tctx.commandContext as unknown as ProductContext & {
      services?: ServiceList;
    };
    // Reads only: never boots a reactor on a one-shot run.
    if (!ctx.folders) return null;
    const log = tctx.context.log as Log | undefined;
    state.running = true;
    const timer = setTimeout(() => {
      log?.warn?.(`${TAG} pass still running after ${PASS_WARN_MS} ms`);
    }, PASS_WARN_MS);
    timer.unref?.();
    void supervise({
      ctx,
      services: ctx.services,
      log,
      done: state.done,
      attempts: state.attempts,
    })
      .catch((err: unknown) => log?.warn?.(`${TAG} pass failed: ${message(err)}`))
      .finally(() => {
        clearTimeout(timer);
        state.running = false;
      });
    return null;
  },
});
