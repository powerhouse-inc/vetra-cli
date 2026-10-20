/**
 * Start a Studio's product from the customer's idea (M0, Task 0.6).
 *
 * Creates the product document, the first conversation, the first change
 * (FIRST_BUILD, linked to that conversation) and sends the idea as the first
 * message, which starts the agent. Both documents are written by the agent
 * server-side, so they are created under the legacy signature policy (R17).
 *
 * Idempotent: a drive that already has a product document starts nothing and
 * gets that product back.
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
  /** Reads an existing product to return its conversation; optional. */
  getDocument?: (documentId: string) => Promise<PHDocument | undefined>;
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

const defaultDeps: StartProductDeps = {
  addDocument: (driveId, name, documentType) =>
    addAgentWritableDocument(driveId, name, documentType),
  dispatch: dispatchOrThrow,
  now: () => new Date().toISOString(),
  newId: generateId,
};

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
 * True when the drive is a new Studio: no product document, no conversation
 * and no project documents (F4 — older Studios keep today's page).
 */
export function canStartFromIdea(drive: StartProductDrive): boolean {
  return !drive.state.global.nodes.some(
    (n) =>
      n.kind === "file" &&
      ((n as FileNode).documentType === studioProductDocumentType ||
        (n as FileNode).documentType === CHAT_SESSION_TYPE ||
        SPECIFY_TYPES.has((n as FileNode).documentType)),
  );
}

/** The conversation of an existing product's active change, if readable. */
async function existingSessionId(
  productId: string,
  deps: StartProductDeps,
): Promise<string> {
  const doc = await deps.getDocument?.(productId).catch(() => undefined);
  const global = (doc?.state as { global?: unknown } | undefined)?.global as
    | {
        activeChangeId?: string | null;
        changes?: { id: string; chatSessionId?: string | null }[];
      }
    | undefined;
  const change = global?.changes?.find((c) => c.id === global.activeChangeId);
  return change?.chatSessionId ?? "";
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
  const existing = findProductNode(drive);
  if (existing) {
    return {
      productId: existing.id,
      sessionId: await existingSessionId(existing.id, deps),
    };
  }
  const text = idea.trim();
  if (!text) throw new Error("Describe your idea first.");
  const productName = name?.trim() || placeholderName(text);
  const driveId = drive.header.id;
  const at = deps.now();

  const sessionCount = filesOfType(drive, CHAT_SESSION_TYPE).length;
  const session = await deps.addDocument(
    driveId,
    `Session ${sessionCount + 1}`,
    CHAT_SESSION_TYPE,
  );
  const product = await deps.addDocument(
    driveId,
    productName,
    studioProductDocumentType,
  );
  await deps.dispatch(product.id, [
    productActions.initProduct({
      name: productName,
      idea: text,
      createdAt: at,
    }),
    productActions.startChange({
      id: deps.newId(),
      kind: "FIRST_BUILD",
      request: text,
      chatSessionId: session.id,
      startedAt: at,
    }),
  ]);
  // Last: the message starts the agent, which expects the product to exist.
  await deps.dispatch(session.id, [
    chatActions.addUserMessage({
      id: deps.newId(),
      content: [{ id: deps.newId(), type: "TEXT", text }],
      createdAt: at,
    }),
  ]);
  return { productId: product.id, sessionId: session.id };
}
