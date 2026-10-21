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

export const defaultDeps: StartProductDeps = {
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
  /** Any change at all (launched, closed and adopted ones included). */
  hasChanges: boolean;
  /** A change other than the first build (e.g. adopted BEFORE_VERSIONS). */
  hasOtherChanges: boolean;
  /** The first build's status, when there is one. */
  firstBuildStatus: string | null;
  /** The first build's conversation, when it has one. */
  firstBuildSessionId: string | null;
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
    changes?: {
      kind?: string;
      status?: string;
      chatSessionId?: string | null;
    }[];
  };
  const changes = g.changes ?? [];
  const firstBuild = changes.find((c) => c.kind === "FIRST_BUILD");
  return {
    idea: g.idea ?? null,
    initialised: (g.idea ?? null) !== null || (g.createdAt ?? null) !== null,
    hasChanges: changes.length > 0,
    hasOtherChanges: changes.some((c) => c.kind !== "FIRST_BUILD"),
    firstBuildStatus: firstBuild ? (firstBuild.status ?? "BUILDING") : null,
    firstBuildSessionId: firstBuild?.chatSessionId ?? null,
  };
}

/** A conversation listed in the drive; `doc` undefined while not loaded. */
interface SessionInfo {
  id: string;
  doc: PHDocument | undefined;
}

/**
 * Whether a product's first start is complete (binding rule, Task 0.6 fix
 * round 3). `yes` when any of:
 * (a) a change whose kind is not FIRST_BUILD (e.g. adopted BEFORE_VERSIONS);
 * (b) the FIRST_BUILD's status is anything but BUILDING (a launched product
 *     keeps an old activeChangeId, so the active change is never consulted);
 * (c) the FIRST_BUILD's linked conversation is listed and has a user message;
 * (d) only when that conversation is not listed: any conversation in the
 *     drive has a user message (legacy fallback).
 * `unknown` while the conversation that decides is listed but not loaded:
 * the box stays hidden, and a retry after it loads can still send.
 */
function productStarted(
  product: ProductView,
  sessions: readonly SessionInfo[],
): "yes" | "no" | "unknown" {
  if (!product.hasChanges) return "no";
  if (product.hasOtherChanges) return "yes";
  if (product.firstBuildStatus !== "BUILDING") return "yes";
  const linked = sessions.find((x) => x.id === product.firstBuildSessionId);
  if (linked) {
    if (!linked.doc) return "unknown";
    return hasUserMessage(linked.doc) ? "yes" : "no";
  }
  if (sessions.some((x) => x.doc && hasUserMessage(x.doc))) return "yes";
  return sessions.some((x) => !x.doc) ? "unknown" : "no";
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
    const sessions = filesOfType(drive, CHAT_SESSION_TYPE).map((n) => ({
      id: n.id,
      doc: byId.get(n.id),
    }));
    return productStarted(productView(doc), sessions) === "no"
      ? "idea"
      : "started";
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

/** The story's first line for a new product (spec §5.3). */
export function firstStoryLine(title: string): string {
  return `Got it — planning ${title}.`;
}

/** The conversation to open after a start, or undefined for none ("" is
 *  returned when the product's conversation is no longer in the drive). */
export function sessionToOpen(result: StartProductResult): string | undefined {
  return result.sessionId || undefined;
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
  const listed = filesOfType(drive, CHAT_SESSION_TYPE);
  const sessions: SessionInfo[] = await Promise.all(
    listed.map(async (n) => ({ id: n.id, doc: await deps.getDocument(n.id) })),
  );

  const linked = product?.firstBuildSessionId ?? null;
  const linkedListed = linked !== null && listed.some((n) => n.id === linked);
  const started = product ? productStarted(product, sessions) : "no";
  // Finished already (also a launched or adopted product): start nothing.
  // The conversation is returned only while the drive still lists it.
  if (productNode && started === "yes") {
    return { productId: productNode.id, sessionId: linkedListed ? linked : "" };
  }
  if (started === "unknown") {
    throw new Error(
      "Your conversation is still loading. Try again in a moment.",
    );
  }

  const text = (product?.idea ?? idea).trim();
  if (!text) throw new Error("Describe your idea first.");
  const at = deps.now();

  // The first build's conversation when it is still in the drive. A change
  // whose conversation is gone can't be relinked (no such operation): the
  // first message goes to an unused or new conversation, which then counts
  // as started by rule (d), so this doesn't loop.
  if (product?.hasChanges && !linkedListed) {
    console.warn(
      `[startProduct] first build's conversation ${linked ?? "(none)"} is not in the drive; sending the idea to another conversation`,
    );
  }
  const sessionId =
    (linkedListed ? linked : null) ??
    sessions.find((x) => x.doc && messagesOf(x.doc).length === 0)?.id ??
    (
      await deps.addDocument(
        driveId,
        `Session ${listed.length + 1}`,
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
  if (!product?.hasChanges) {
    const changeId = deps.newId();
    productOps.push(
      productActions.startChange({
        id: changeId,
        kind: "FIRST_BUILD",
        request: text,
        chatSessionId: sessionId,
        startedAt: at,
      }),
      // The story's first line, there before the agent's first step (§5.3).
      productActions.addMilestone({
        changeId,
        id: deps.newId(),
        text: firstStoryLine(productName),
        at,
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
