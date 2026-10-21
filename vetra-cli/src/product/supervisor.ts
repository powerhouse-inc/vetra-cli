/**
 * Product supervisor trigger: every few seconds, reads the product document,
 * the active change's chat session and the preview's status, asks the rules
 * (`supervisor-rules.ts`) what to do and does it — mark the change stuck,
 * continue a turn the step cap ended, flag a slow preview, record metrics.
 *
 * Each action is carried out once (by its key) per process. A failure is
 * logged and never reaches the agent's turn; a stalled reactor is given up on
 * after a timeout so the routine loop keeps going.
 */
import { randomUUID } from "node:crypto";
import type { Action } from "document-model";
import type { ChatSessionState } from "@powerhousedao/clint-common/document-models/chat-session";
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import { defineTrigger } from "../framework.js";
import { getEmbeddedDrive } from "../helpers/embedded-drive.js";
import {
  activeChange,
  dispatchProduct,
  getProductDoc,
  productActions as a,
  type ProductContext,
} from "./product-doc.js";
import {
  CONTINUE_TEXT,
  PREVIEW_SLOW_REASON,
  evaluate,
  type SupervisorAction,
  type SupervisorObservations,
} from "./supervisor-rules.js";

const TAG = "[product-supervisor]";
/** How often the rules run (the shortest rule threshold is 60 s). */
export const SUPERVISOR_INTERVAL_MS = 10_000;
const PASS_TIMEOUT_MS = 15_000;
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
  /** Keys already carried out (kept across passes by the trigger). */
  done: Set<string>;
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
    if (!product || !change) return carried;
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
    };
    const at = now.toISOString();
    for (const action of evaluate(product.state, chat, now, observed)) {
      if (done.has(action.key)) continue;
      // Marked before trying: a refused action is not retried every pass.
      done.add(action.key);
      try {
        await carryOut(deps, action, at);
        carried.push(action);
      } catch (err) {
        log?.warn?.(`${TAG} ${action.type} failed: ${message(err)}`);
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
}

export const productSupervisorTrigger = defineTrigger<SupervisorState>({
  id: "product-supervisor",
  type: "condition",
  state: () => ({ lastPassAt: 0, running: false, done: new Set<string>() }),

  async poll(tctx) {
    const nowMs = Date.now();
    // A pass that outlived its timeout is still running: never two at once.
    if (tctx.state.running || nowMs - tctx.state.lastPassAt < SUPERVISOR_INTERVAL_MS) return null;
    tctx.state.lastPassAt = nowMs;
    const ctx = tctx.commandContext as unknown as ProductContext & {
      services?: ServiceList;
    };
    // Reads only: never boots a reactor on a one-shot run.
    if (!ctx.folders) return null;
    const log = tctx.context.log as Log | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log?.warn?.(`${TAG} pass timed out after ${PASS_TIMEOUT_MS} ms`);
        resolve();
      }, PASS_TIMEOUT_MS);
    });
    const state = tctx.state;
    state.running = true;
    const pass = supervise({ ctx, services: ctx.services, log, done: state.done }).finally(() => {
      state.running = false;
    });
    try {
      await Promise.race([pass, timeout]);
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});
