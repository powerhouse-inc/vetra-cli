/**
 * Derive the BUILD pane's preview target from a chat-session document.
 *
 * The agent surfaces a preview to the user by calling `spec-preview-show`.
 * Its tool result carries `{ data: { projectPath, driveId, documentId,
 * documentSlug, previewUrl } }` and the tool call's args carry the `project`
 * the agent passed. We pair the latest non-error `spec-preview-show` result
 * with its originating call (via `toolCallId`) and emit `{ project, doc }`.
 *
 * Deliberately *only* `spec-preview-show` — `spec-preview-create` doesn't
 * surface the preview, by design (the agent must explicitly show).
 *
 * `doc` is the slug when available, else the id — same precedence as the
 * URL produced by `spec-preview-show` server-side.
 */
import { useMemo } from "react";
import type { ChatSessionDocument } from "@powerhousedao/clint-common/document-models/chat-session";

const SHOW_TOOL_NAME = "spec-preview-show";

export interface PreviewTarget {
  project: string;
  doc: string;
}

interface ShowToolResultData {
  data?: {
    projectPath?: string;
    driveId?: string;
    documentId?: string;
    documentSlug?: string | null;
    previewUrl?: string;
  };
}

interface ShowToolCallArgs {
  project?: string;
  name?: string;
}

export function useSessionPreviewTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  return useMemo(() => extractPreviewTarget(session), [session?.state]);
}

/**
 * Pure extraction logic — exported separately so it can be unit-tested
 * without spinning up a React renderer. The hook above is a thin `useMemo`
 * over this function.
 */
export function extractPreviewTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  if (!session) return undefined;
  const messages = session.state.global.messages;
  if (!messages || messages.length === 0) return undefined;

  /* Walk backwards. For the first non-error spec-preview-show TOOL_RESULT we
   * find, locate the matching TOOL_CALL by toolCallId to recover `project`. */
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (part.type !== "TOOL_RESULT") continue;
      if (part.toolName !== SHOW_TOOL_NAME) continue;
      if (part.isError) continue;
      if (!part.toolCallId || !part.result) continue;

      const data = safeParse<ShowToolResultData>(part.result);
      const doc = data?.data?.documentSlug ?? data?.data?.documentId;
      if (!doc) continue;

      const call = findToolCall(messages, part.toolCallId);
      const project = call?.project;
      if (!project) continue;

      return { project, doc };
    }
  }
  return undefined;
}

function findToolCall(
  messages: ChatSessionDocument["state"]["global"]["messages"],
  toolCallId: string,
): ShowToolCallArgs | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (const part of msg.content) {
      if (part.type !== "TOOL_CALL") continue;
      if (part.toolCallId !== toolCallId) continue;
      if (!part.args) return undefined;
      return safeParse<ShowToolCallArgs>(part.args);
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
