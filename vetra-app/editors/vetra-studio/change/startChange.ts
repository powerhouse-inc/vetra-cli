/**
 * Start a change to the live product from the browser (ruling F19): every
 * UI-started change ("What should change?", a suggestion, Undo with the
 * agent) goes through here — the same pattern as `startProduct`.
 *
 * - No change in progress: a new conversation for the change (D: each change
 *   has its own), `START_CHANGE` linked to it, then the request as its first
 *   message, which starts the agent. The agent side bases the change on the
 *   live version's code.
 * - A change already BUILDING, PAUSED or READY (D13, "Keep changing"): the
 *   request goes into that change's conversation and accumulates into the
 *   same draft version.
 */
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import type { FileNode } from "@powerhousedao/shared/document-drive";
import {
  actions as productActions,
  normalizeProduct,
  type Change,
  type StudioProductState,
} from "document-models/studio-product";
import {
  CHAT_SESSION_TYPE,
  defaultDeps,
  type StartProductDeps,
  type StartProductDrive,
} from "../idea/startProduct.js";

export interface StartChangeInput {
  drive: StartProductDrive;
  productId: string;
  request: string;
  kind: "CHANGE" | "UNDO";
}

export interface StartChangeResult {
  changeId: string;
  sessionId: string;
}

export type StartChangeDeps = StartProductDeps;

/** Changes a new request joins instead of starting another one (D13). */
const JOINABLE: readonly Change["status"][] = ["BUILDING", "PAUSED", "READY"];

function productState(global: unknown): StudioProductState | undefined {
  if (!global || typeof global !== "object") return undefined;
  // normalizeProduct fills in place: work on a copy.
  return normalizeProduct(structuredClone(global) as StudioProductState);
}

/* One start per product at a time: a double submit joins the first one. */
const inFlight = new Map<string, Promise<StartChangeResult>>();

export function startChange(
  input: StartChangeInput,
  deps: StartChangeDeps = defaultDeps,
): Promise<StartChangeResult> {
  const running = inFlight.get(input.productId);
  if (running) return running;
  const started = run(input, deps).finally(() =>
    inFlight.delete(input.productId),
  );
  inFlight.set(input.productId, started);
  return started;
}

async function sendMessage(
  deps: StartChangeDeps,
  sessionId: string,
  text: string,
  at: string,
): Promise<void> {
  await deps.dispatch(sessionId, [
    chatActions.addUserMessage({
      id: deps.newId(),
      content: [{ id: deps.newId(), type: "TEXT", text }],
      createdAt: at,
    }),
  ]);
}

async function run(
  { drive, productId, request, kind }: StartChangeInput,
  deps: StartChangeDeps,
): Promise<StartChangeResult> {
  const text = request.trim();
  if (!text) throw new Error("Say what should change first.");
  const doc = await deps.getDocument(productId);
  const product = productState(
    (doc?.state as { global?: unknown } | undefined)?.global,
  );
  if (!product) {
    throw new Error("Your product is still loading. Try again in a moment.");
  }
  const at = deps.now();

  const active = product.changes.find((c) => c.id === product.activeChangeId);
  if (active?.status === "LAUNCHING") {
    throw new Error("Your change is going live. Try again in a moment.");
  }
  if (active && JOINABLE.includes(active.status) && active.chatSessionId) {
    await sendMessage(deps, active.chatSessionId, text, at);
    return { changeId: active.id, sessionId: active.chatSessionId };
  }

  const sessions = drive.state.global.nodes.filter(
    (n): n is FileNode =>
      n.kind === "file" && (n as FileNode).documentType === CHAT_SESSION_TYPE,
  );
  const sessionId = (
    await deps.addDocument(
      drive.header.id,
      `Session ${sessions.length + 1}`,
      CHAT_SESSION_TYPE,
    )
  ).id;
  const changeId = deps.newId();
  await deps.dispatch(productId, [
    productActions.startChange({
      id: changeId,
      kind,
      request: text,
      chatSessionId: sessionId,
      startedAt: at,
    }),
  ]);
  // Last: the message starts the agent, which expects the change to exist.
  await sendMessage(deps, sessionId, text, at);
  return { changeId, sessionId };
}
