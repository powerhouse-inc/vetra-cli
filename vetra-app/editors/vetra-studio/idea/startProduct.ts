/**
 * Start a Studio's product from the customer's idea (M0, Task 0.6).
 *
 * Creates the first conversation, the product document, the first change
 * (FIRST_BUILD, linked to that conversation) and sends the idea as the first
 * message, which starts the agent. Both documents are written by the agent
 * server-side, so they are created under the legacy signature policy (R17).
 *
 * Resumable: each call does only the parts that are missing (a session, the
 * product, INIT_PRODUCT, START_CHANGE, the first message), so a start that
 * failed half-way completes on retry. A product whose change already has its
 * first message starts nothing and is returned as is.
 */
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import { dispatchActions } from "@powerhousedao/reactor-browser";
import type { FileNode, Node } from "@powerhousedao/shared/document-drive";
import { generateId, type Action, type PHDocument } from "document-model";
import {
  actions as productActions,
  placeholderName,
  studioProductDocumentType,
} from "document-models/studio-product";
import { addAgentWritableDocument } from "../addAgentWritableDocument.js";
import { SPECIFY_TYPES } from "../specify/projects.js";

export const CHAT_SESSION_TYPE = "powerhouse/chat-session";

/** Change statuses that can still be worked on (mirrors the reducer). */
const OPEN_CHANGE = ["BUILDING", "PAUSED", "READY", "LAUNCHING"];

/** The parts of a drive document startProduct reads. */
export interface StartProductDrive {
  header: { id: string };
  state: { global: { nodes: readonly Node[] } };
}

export interface StartProductInput {
  drive: StartProductDrive;
  idea: string;
  /** Product name; defaults to the first words of the idea until the agent renames it. */
  name?: string;
}

export interface StartProductResult {
  productId: string;
  sessionId: string;
}

export interface StartProductDeps {
  addDocument: (
    driveId: string,
    name: string,
    documentType: string,
  ) => Promise<{ id: string }>;
  dispatch: (documentId: string, actions: Action[]) => Promise<void>;
  /** Reads a document; resolves undefined when it can't be read (yet). */
  getDocument: (documentId: string) => Promise<PHDocument | undefined>;
  now: () => string;
  newId: () => string;
}

async function dispatchOrThrow(
  documentId: string,
  actions: Action[],
): Promise<void> {
  let failure: Error | undefined;
  await dispatchActions(actions, documentId, (errors) => {
    failure = errors[0];
  });
  if (failure) throw failure;
}

async function readDocument(id: string): Promise<PHDocument | undefined> {
  const client = window.ph?.reactorClientModule?.client;
  if (!client) return undefined;
  try {
    return await client.get(id);
  } catch {
    return undefined;
  }
}

const defaultDeps: StartProductDeps = {
  addDocument: (driveId, name, documentType) =>
    addAgentWritableDocument(driveId, name, documentType),
  dispatch: dispatchOrThrow,
  getDocument: readDocument,
  now: () => new Date().toISOString(),
  newId: generateId,
};

/* ── Reading the documents (structural, tolerant of older documents) ── */

interface ProductView {
  idea: string | null;
  initialised: boolean;
  change: { id: string; chatSessionId: string | null } | null;
}

function globalOf(doc: PHDocument | undefined): Record<string, unknown> {
  const global = (doc?.state as { global?: unknown } | undefined)?.global;
  return global && typeof global === "object"
    ? (global as Record<string, unknown>)
    : {};
}

function productView(doc: PHDocument | undefined): ProductView {
  const g = globalOf(doc) as {
    idea?: string | null;
    createdAt?: string | null;
    activeChangeId?: string | null;
    changes?: { id: string; status?: string; chatSessionId?: string | null }[];
  };
  const change = (g.changes ?? []).find(
    (c) => c.id === g.activeChangeId && OPEN_CHANGE.includes(c.status ?? ""),
  );
  return {
    idea: g.idea ?? null,
    initialised: (g.idea ?? null) !== null || (g.createdAt ?? null) !== null,
    change: change
      ? { id: change.id, chatSessionId: change.chatSessionId ?? null }
      : null,
  };
}

function messagesOf(doc: PHDocument | undefined): { role?: string }[] {
  const messages = globalOf(doc).messages;
  return Array.isArray(messages) ? (messages as { role?: string }[]) : [];
}

function hasUserMessage(doc: PHDocument | undefined): boolean {
  return messagesOf(doc).some((m) => m.role === "USER");
}

function filesOfType(drive: StartProductDrive, documentType: string) {
  return drive.state.global.nodes.filter(
    (n): n is FileNode =>
      n.kind === "file" && (n as FileNode).documentType === documentType,
  );
}

/** The drive's product document node, if it has one. */
export function findProductNode(
  drive: StartProductDrive,
): FileNode | undefined {
  return filesOfType(drive, studioProductDocumentType)[0];
}

/**
 * Where the drive stands for the temporary idea start:
 * - `idea`: no product has a started change with a first message yet — show
 *   the idea box (also after a start that failed half-way, so it can resume);
 * - `started`: the product's change has its first message;
 * - `legacy`: no product, but conversations with messages or project
 *   documents — an older Studio keeps today's page (F4).
 * `documents` are the drive's loaded documents; one not loaded yet counts as
 * started/used, so the box never offers a second first message.
 */
export function ideaStartStatus(
  drive: StartProductDrive,
  documents: readonly PHDocument[],
): "idea" | "started" | "legacy" {
  const byId = new Map(documents.map((d) => [d.header.id, d]));
  const product = findProductNode(drive);
  if (product) {
    const doc = byId.get(product.id);
    if (!doc) return "started";
    const { change } = productView(doc);
    if (!change?.chatSessionId) return "idea";
    const session = byId.get(change.chatSessionId);
    if (!session) {
      // Not synced yet: started only if the drive already lists it.
      return filesOfType(drive, CHAT_SESSION_TYPE).some(
        (n) => n.id === change.chatSessionId,
      )
        ? "started"
        : "idea";
    }
    return hasUserMessage(session) ? "started" : "idea";
  }
  const hasProject = drive.state.global.nodes.some(
    (n) => n.kind === "file" && SPECIFY_TYPES.has((n as FileNode).documentType),
  );
  if (hasProject) return "legacy";
  const usedSession = filesOfType(drive, CHAT_SESSION_TYPE).some((n) => {
    const doc = byId.get(n.id);
    return !doc || messagesOf(doc).length > 0;
  });
  return usedSession ? "legacy" : "idea";
}

/** An existing conversation with no messages, left by an earlier attempt. */
async function unusedSession(
  drive: StartProductDrive,
  deps: StartProductDeps,
): Promise<string | undefined> {
  for (const node of filesOfType(drive, CHAT_SESSION_TYPE)) {
    const doc = await deps.getDocument(node.id);
    if (doc && messagesOf(doc).length === 0) return node.id;
  }
  return undefined;
}

/* One start per drive at a time: a double submit joins the first one. */
const inFlight = new Map<string, Promise<StartProductResult>>();

export function startProduct(
  input: StartProductInput,
  deps: StartProductDeps = defaultDeps,
): Promise<StartProductResult> {
  const driveId = input.drive.header.id;
  const running = inFlight.get(driveId);
  if (running) return running;
  const started = run(input, deps).finally(() => inFlight.delete(driveId));
  inFlight.set(driveId, started);
  return started;
}

async function run(
  { drive, idea, name }: StartProductInput,
  deps: StartProductDeps,
): Promise<StartProductResult> {
  const driveId = drive.header.id;
  const productNode = findProductNode(drive);
  const product = productNode
    ? productView(await deps.getDocument(productNode.id))
    : null;
  const change = product?.change ?? null;

  // Finished already: the change's conversation has its first message.
  if (productNode && change?.chatSessionId) {
    const session = await deps.getDocument(change.chatSessionId);
    if (hasUserMessage(session)) {
      return { productId: productNode.id, sessionId: change.chatSessionId };
    }
  }

  const text = (product?.idea ?? idea).trim();
  if (!text) throw new Error("Describe your idea first.");
  const at = deps.now();

  const sessionId =
    change?.chatSessionId ??
    (await unusedSession(drive, deps)) ??
    (
      await deps.addDocument(
        driveId,
        `Session ${filesOfType(drive, CHAT_SESSION_TYPE).length + 1}`,
        CHAT_SESSION_TYPE,
      )
    ).id;

  const productName = name?.trim() || placeholderName(text);
  const productId =
    productNode?.id ??
    (await deps.addDocument(driveId, productName, studioProductDocumentType))
      .id;

  const productOps: Action[] = [];
  if (!product?.initialised) {
    productOps.push(
      productActions.initProduct({
        name: productName,
        idea: text,
        createdAt: at,
      }),
    );
  }
  if (!change) {
    productOps.push(
      productActions.startChange({
        id: deps.newId(),
        kind: "FIRST_BUILD",
        request: text,
        chatSessionId: sessionId,
        startedAt: at,
      }),
    );
  }
  if (productOps.length > 0) await deps.dispatch(productId, productOps);

  // Last: the message starts the agent, which expects the product to exist.
  await deps.dispatch(sessionId, [
    chatActions.addUserMessage({
      id: deps.newId(),
      content: [{ id: deps.newId(), type: "TEXT", text }],
      createdAt: at,
    }),
  ]);
  return { productId, sessionId };
}
