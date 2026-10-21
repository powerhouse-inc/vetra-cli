/**
 * Start a change after launch (spec §5.7, D13, D17; Ruling F19): "Change
 * something", a suggestion, "Undo with the agent" and "Keep changing" all go
 * through here.
 *
 * - No change open: a new conversation (created agent-writable, R17),
 *   `START_CHANGE` linked to it, then the request as its first message, which
 *   starts the agent. The agent puts the live version's code under the new
 *   change before it plans (vetra-cli `prepareChangeBase`).
 * - A change BUILDING, PAUSED or READY: only one change is in progress at a
 *   time, so the request joins it — it is sent to that change's conversation
 *   (a PAUSED change is resumed first, so the agent takes the message). This
 *   is also "Keep changing" on a READY change.
 * - A change going live: refused until the launch ends.
 */
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import type { FileNode } from "@powerhousedao/shared/document-drive";
import type { Action, PHDocument } from "document-model";
import { actions as productActions } from "document-models/studio-product";
import {
  CHAT_SESSION_TYPE,
  defaultStartDeps,
  type StartProductDeps,
  type StartProductDrive,
} from "../idea/startProduct.js";

export type StartChangeKind = "CHANGE" | "UNDO";

export interface StartChangeInput {
  drive: StartProductDrive;
  productId: string;
  request: string;
  kind: StartChangeKind;
}

export interface StartChangeResult {
  changeId: string;
  sessionId: string;
  /** True when the request joined the change already in progress. */
  joined: boolean;
}

export type StartChangeDeps = StartProductDeps;

/** Shown when a request arrives while a change is going live. */
export const CHANGE_LAUNCHING_TEXT =
  "Your change is going live right now. Ask again once it's live.";
/** Shown for an empty request. */
export const EMPTY_REQUEST_TEXT = "Describe what should change first.";

/** Statuses a new request joins instead of starting a change (D13). */
const JOINABLE = new Set(["BUILDING", "PAUSED", "READY"]);

interface ChangeView {
  id: string;
  status: string;
  chatSessionId: string | null;
  chatSessionIds: string[];
}

function changesOf(doc: PHDocument | undefined): ChangeView[] {
  const global = (doc?.state as { global?: unknown } | undefined)?.global as
    | {
        changes?: {
          id?: string;
          status?: string;
          chatSessionId?: string | null;
          chatSessionIds?: string[] | null;
        }[];
      }
    | undefined;
  return (global?.changes ?? [])
    .filter(
      (
        c,
      ): c is {
        id: string;
        status?: string;
        chatSessionId?: string | null;
        chatSessionIds?: string[] | null;
      } => typeof c.id === "string",
    )
    .map((c) => ({
      id: c.id,
      status: c.status ?? "BUILDING",
      chatSessionId: c.chatSessionId ?? null,
      chatSessionIds: c.chatSessionIds ?? [],
    }));
}

function hasNoMessages(doc: PHDocument | undefined): boolean {
  const global = (doc?.state as { global?: { messages?: unknown } } | undefined)
    ?.global;
  return Array.isArray(global?.messages) && global.messages.length === 0;
}

function sessionsIn(drive: StartProductDrive): FileNode[] {
  return drive.state.global.nodes.filter(
    (n): n is FileNode =>
      n.kind === "file" && (n as FileNode).documentType === CHAT_SESSION_TYPE,
  );
}

/* One start per product at a time: a double submit joins the first one. */
const inFlight = new Map<string, Promise<StartChangeResult>>();

export function startChange(
  input: StartChangeInput,
  deps: StartChangeDeps = defaultStartDeps,
): Promise<StartChangeResult> {
  const running = inFlight.get(input.productId);
  if (running) return running;
  const started = run(input, deps).finally(() =>
    inFlight.delete(input.productId),
  );
  inFlight.set(input.productId, started);
  return started;
}

async function run(
  { drive, productId, request, kind }: StartChangeInput,
  deps: StartChangeDeps,
): Promise<StartChangeResult> {
  const text = request.trim();
  if (!text) throw new Error(EMPTY_REQUEST_TEXT);
  const product = await deps.getDocument(productId);
  if (!product) {
    throw new Error("Your product is still loading. Try again in a moment.");
  }
  const changes = changesOf(product);
  if (changes.some((c) => c.status === "LAUNCHING")) {
    throw new Error(CHANGE_LAUNCHING_TEXT);
  }
  const at = deps.now();
  const listed = sessionsIn(drive);
  const message = (sessionId: string) =>
    deps.dispatch(sessionId, [
      chatActions.addUserMessage({
        id: deps.newId(),
        content: [{ id: deps.newId(), type: "TEXT", text }],
        createdAt: at,
      }),
    ]);
  // A conversation no change uses and nobody wrote in (left by a start that
  // failed half-way) is reused, so a retry doesn't leave empty ones behind.
  const linked = new Set(
    changes.flatMap((c) => [
      ...c.chatSessionIds,
      ...(c.chatSessionId ? [c.chatSessionId] : []),
    ]),
  );
  const newSession = async () => {
    for (const node of listed) {
      if (linked.has(node.id)) continue;
      if (hasNoMessages(await deps.getDocument(node.id))) return node.id;
    }
    return (
      await deps.addDocument(
        drive.header.id,
        `Session ${listed.length + 1}`,
        CHAT_SESSION_TYPE,
      )
    ).id;
  };

  const open = changes.find((c) => JOINABLE.has(c.status));
  if (open) {
    if (open.status === "PAUSED") {
      await deps.dispatch(productId, [
        productActions.resumeChange({ changeId: open.id, at }),
      ]);
    }
    // A change whose conversation is gone can't be relinked (no such
    // operation): the agent still works on the active change from any.
    const own =
      open.chatSessionId && listed.some((n) => n.id === open.chatSessionId)
        ? open.chatSessionId
        : null;
    if (!own) {
      console.warn(
        `[startChange] change ${open.id}'s conversation ${open.chatSessionId ?? "(none)"} is not in the drive; using a new one`,
      );
    }
    const sessionId = own ?? (await newSession());
    await message(sessionId);
    return { changeId: open.id, sessionId, joined: true };
  }

  // Its own conversation (D17), then the change, then the message: the
  // message starts the agent, which expects the change to exist.
  const sessionId = await newSession();
  const changeId = deps.newId();
  const ops: Action[] = [
    productActions.startChange({
      id: changeId,
      kind,
      request: text,
      chatSessionId: sessionId,
      startedAt: at,
    }),
  ];
  await deps.dispatch(productId, ops);
  await message(sessionId);
  return { changeId, sessionId, joined: false };
}
