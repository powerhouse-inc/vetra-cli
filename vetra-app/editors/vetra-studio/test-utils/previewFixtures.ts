/** Editor/app spec documents and conversation turns for preview tests. */
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";
import type { PHDocument } from "document-model";
import { APP_SPEC_TYPE, EDITOR_SPEC_TYPE } from "../preview/previewTabs.js";

export type Messages = ChatSessionDocument["state"]["global"]["messages"];

export function specDoc(
  id: string,
  documentType: string,
  global: Record<string, unknown>,
): PHDocument {
  return {
    header: { id, documentType, name: id },
    state: { global },
  } as unknown as PHDocument;
}

/** Kitchen queue (app, draft), Order editor, a data model, Menu editor. */
export const SCREEN_DOCS: PHDocument[] = [
  specDoc("app-1", APP_SPEC_TYPE, { name: "Kitchen queue", status: "DRAFT" }),
  specDoc("ed-order", EDITOR_SPEC_TYPE, {
    name: "OrderEditor",
    status: "CONFIRMED",
    documentTypes: [{ id: "t1", documentType: "hotel/order" }],
  }),
  specDoc("model-1", "powerhouse/document-model", { name: "Order" }),
  specDoc("ed-menu", EDITOR_SPEC_TYPE, {
    name: "menu",
    status: "CONFIRMED",
    documentTypes: [{ id: "t2", documentType: "hotel/menu" }],
  }),
];

let seq = 0;
/** One assistant message with a tool call and its result. */
export function toolTurn(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  isError = false,
): Messages[number] {
  seq += 1;
  const toolCallId = `call-${seq}`;
  return {
    id: `m-${seq}`,
    role: "ASSISTANT",
    content: [
      { type: "TOOL_CALL", toolCallId, toolName, args: JSON.stringify(args) },
      {
        type: "TOOL_RESULT",
        toolCallId,
        toolName,
        isError,
        result: typeof result === "string" ? result : JSON.stringify(result),
      },
    ],
  } as unknown as Messages[number];
}
