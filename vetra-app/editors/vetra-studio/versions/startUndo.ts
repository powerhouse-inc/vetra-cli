/**
 * "Undo with the agent" (spec §5.7, D6): when the product's data can't go
 * back to a version, the customer asks the agent to undo the change instead.
 * Same pattern as `startProduct` (Ruling F19): a new conversation, then
 * START_CHANGE (kind UNDO) linked to it, then the request as its first
 * message, which starts the agent.
 */
import { actions as chatActions } from "@powerhousedao/clint-common/document-models/chat-session";
import { dispatchActions } from "@powerhousedao/reactor-browser";
import { generateId, type Action } from "document-model";
import { actions as productActions } from "document-models/studio-product";
import { addAgentWritableDocument } from "../addAgentWritableDocument.js";
import { CHAT_SESSION_TYPE } from "../idea/startProduct.js";
import { undoRequest } from "./versionRows.js";

export interface StartUndoDeps {
  addDocument: (
    driveId: string,
    name: string,
    documentType: string,
  ) => Promise<{ id: string }>;
  dispatch: (documentId: string, actions: Action[]) => Promise<void>;
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

const defaultDeps: StartUndoDeps = {
  addDocument: (driveId, name, documentType) =>
    addAgentWritableDocument(driveId, name, documentType),
  dispatch: dispatchOrThrow,
  now: () => new Date().toISOString(),
  newId: generateId,
};

/** Starts the UNDO change for the version titled `title`. */
export async function startUndo(
  {
    driveId,
    productId,
    title,
  }: { driveId: string; productId: string; title: string },
  deps: StartUndoDeps = defaultDeps,
): Promise<{ changeId: string; sessionId: string }> {
  const request = undoRequest(title);
  const at = deps.now();
  const session = await deps.addDocument(driveId, request, CHAT_SESSION_TYPE);
  const changeId = deps.newId();
  await deps.dispatch(productId, [
    productActions.startChange({
      id: changeId,
      kind: "UNDO",
      request,
      chatSessionId: session.id,
      startedAt: at,
    }),
  ]);
  // Last: the message starts the agent, which expects the change to exist.
  await deps.dispatch(session.id, [
    chatActions.addUserMessage({
      id: deps.newId(),
      content: [{ id: deps.newId(), type: "TEXT", text: request }],
      createdAt: at,
    }),
  ]);
  return { changeId, sessionId: session.id };
}
