/**
 * Derive the document the selected chat session's agent most recently
 * created/updated, from that session's own transcript.
 *
 * `spec-create` / `spec-update` tool results carry `{ data: { documentId,
 * documentType, name } }` (see the vetra spec commands). We walk the
 * transcript backward and return the latest non-error one, keyed by its
 * `toolCallId` so a consumer can tell a NEW edit apart from the same one
 * re-rendered. Reading the SELECTED session's messages is what scopes
 * auto-navigation to that session — an edit in another session never appears
 * here. Mirrors `useSessionPreviewTarget`.
 *
 * Navigability (whether the type opens in IDEATE/SPECIFY) is NOT decided here —
 * `editFollowAction` handles it — so the newest edit always wins and we never
 * silently fall back to an older navigable doc.
 */
import { useMemo } from "react";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";

const EDIT_TOOLS: ReadonlySet<string> = new Set(["spec-create", "spec-update"]);

export interface EditTarget {
  id: string;
  documentType: string;
  name: string;
  /** toolCallId of the spec-create/spec-update result that produced this — lets
   * consumers tell a NEW edit apart from the same one re-rendered. */
  callId: string;
}

interface EditToolResultData {
  data?: {
    documentId?: string | null;
    documentType?: string | null;
    name?: string | null;
  };
}

export function useSessionEditedDocument(
  session: ChatSessionDocument | undefined,
): EditTarget | undefined {
  return useMemo(() => extractEditedDocument(session), [session?.state]);
}

/**
 * Pure extraction logic — exported separately so it can be unit-tested without
 * a React renderer. The hook above is a thin `useMemo` over this function.
 */
export function extractEditedDocument(
  session: ChatSessionDocument | undefined,
): EditTarget | undefined {
  if (!session) return undefined;
  const messages = session.state.global.messages;
  if (messages.length === 0) return undefined;

  /* Walk backwards for the first non-error spec-create/spec-update TOOL_RESULT
   * carrying a complete `data` payload. Results missing `data.documentId` (e.g.
   * a dryRun create) are skipped, so we fall through to an earlier real edit. */
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (part.type !== "TOOL_RESULT") continue;
      if (!part.toolName || !EDIT_TOOLS.has(part.toolName)) continue;
      if (part.isError) continue;
      if (!part.toolCallId || !part.result) continue;

      const data = safeParse<EditToolResultData>(part.result)?.data;
      if (!data?.documentId || !data.documentType || !data.name) continue;

      return {
        id: data.documentId,
        documentType: data.documentType,
        name: data.name,
        callId: part.toolCallId,
      };
    }
  }
  return undefined;
}

function safeParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
