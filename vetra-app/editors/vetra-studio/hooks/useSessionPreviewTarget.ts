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

/**
 * Same rule as the CLI's `isPreviewDriveId` (vetra-cli's
 * `reactor-project-preview.ts`): a drive id is one URL-safe path segment.
 * A result carrying anything else (e.g. the `">` HTML fragment a tool call
 * once sent) must not become a preview target — the pane would load a 404
 * iframe instead of the app.
 */
export function isPreviewDriveId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(value);
}

export interface PreviewTarget {
  project: string;
  doc?: string;
  drive?: string;
  /** The project's preview drive root (Connect's drive view): shown once
   *  the project is up, until the agent shares a screen. */
  home?: true;
  /** toolCallId of the spec-preview-show that produced this target — lets
   * consumers tell a NEW show apart from the same one re-rendered, even when
   * project/doc are unchanged. */
  callId: string;
}

interface ShowToolResultData {
  data?: {
    /** The project label (newer CLIs; the call may leave `project` out). */
    project?: string;
    projectPath?: string;
    driveId?: string;
    documentId?: string | null;
    documentSlug?: string | null;
    previewUrl?: string;
    kind?: string;
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
  if (messages.length === 0) return undefined;

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

      if (data?.data?.kind === "drive" && data?.data?.driveId) {
        // Ignore a malformed id and keep looking for an earlier good target
        // (the pane then keeps showing the last valid preview).
        if (!isPreviewDriveId(data.data.driveId)) continue;
        const call = findToolCall(messages, part.toolCallId);
        const project = call?.project || data.data.project;
        if (!project) continue;
        return { project, drive: data.data.driveId, callId: part.toolCallId };
      }

      const doc = data?.data?.documentSlug ?? data?.data?.documentId;
      if (!doc) continue;

      const call = findToolCall(messages, part.toolCallId);
      const project = call?.project || data?.data?.project;
      if (!project) continue;

      return { project, doc, callId: part.toolCallId };
    }
  }
  return undefined;
}

const START_TOOL_NAME = "reactor-project-start";

interface StartToolResult {
  text?: string;
  /** Newer CLIs: the project label, also when the call left `workdir` out. */
  data?: { project?: string };
}

/**
 * The project the agent started (the latest `reactor-project-start` that
 * didn't fail), as a `home` target: the pane shows the project's Connect
 * drive view as soon as its preview is up, instead of waiting for the first
 * `spec-preview-show`. Undefined when no start succeeded or its project is
 * unknown.
 */
export function extractProjectHomeTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  if (!session) return undefined;
  const messages = session.state.global.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j];
      if (part.type !== "TOOL_RESULT") continue;
      if (part.toolName !== START_TOOL_NAME) continue;
      if (part.isError || !part.toolCallId || !part.result) continue;
      const result = safeParse<StartToolResult>(part.result);
      // The start command reports a failed start as text, not as an error.
      const text = result ? result.text : part.result;
      if (text?.trimStart().startsWith("✗")) continue;
      const args = findToolCallArgs<{ workdir?: string }>(
        messages,
        part.toolCallId,
      );
      const project = result?.data?.project || args?.workdir;
      if (!project) continue;
      return { project, home: true, callId: part.toolCallId };
    }
  }
  return undefined;
}

/** The pane's home target, memoised on the session state. */
export function useProjectHomeTarget(
  session: ChatSessionDocument | undefined,
): PreviewTarget | undefined {
  return useMemo(() => extractProjectHomeTarget(session), [session?.state]);
}

function findToolCall(
  messages: ChatSessionDocument["state"]["global"]["messages"],
  toolCallId: string,
): ShowToolCallArgs | undefined {
  return findToolCallArgs<ShowToolCallArgs>(messages, toolCallId);
}

function findToolCallArgs<T>(
  messages: ChatSessionDocument["state"]["global"]["messages"],
  toolCallId: string,
): T | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (const part of msg.content) {
      if (part.type !== "TOOL_CALL") continue;
      if (part.toolCallId !== toolCallId) continue;
      if (!part.args) return undefined;
      return safeParse<T>(part.args);
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
