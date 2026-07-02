import { useMemo } from "react";
import { sectionForDocumentType } from "../auto-nav.js";

export type ActivePhase = "ideate" | "specify" | "build" | "deploy";

type Part = { toolCallId?: string | null };
type Message = { role?: string; finishedAt?: unknown; content?: readonly Part[] };

/** The follow signals, keyed by the tool-result callId of the latest action of
 * each kind: `edit*` → ideation/spec edits, preview → BUILD, deploy → DEPLOY.
 * `messages` is the selected session's transcript, used to detect that the
 * agent is mid-turn and to order the actions by recency. */
export type ActivePhaseSignals = {
  messages: readonly Message[] | undefined;
  editDocumentType?: string;
  editCallId: string | null;
  previewCallId: string | null;
  deployCallId: string | null;
};

/** True while the agent is generating a reply: a user message exists and no
 * assistant message after it has finished. Mirrors the chat editor's own
 * send/stop indicator, and is purely message-derived so it syncs to the
 * browser (unlike the session-level `status` badge). */
function isResponding(messages: readonly Message[]): boolean {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "USER") {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) return false;
  for (let i = lastUser + 1; i < messages.length; i++) {
    if (messages[i].role === "ASSISTANT" && messages[i].finishedAt) return false;
  }
  return true;
}

/** Index of the last message referencing a tool call/result by id, or -1. */
function callIndex(messages: readonly Message[], callId: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].content?.some((p) => p.toolCallId === callId)) return i;
  }
  return -1;
}

/**
 * The phase the selected session's agent is currently working on, or null when
 * it isn't generating. While the agent responds, this is the phase of its
 * most-recent followable action (by transcript position), so the home overview
 * pulses that phase continuously and switches as the agent moves between
 * phases. Null when idle or when no action maps to a phase yet.
 */
export function useActivePhase(signals: ActivePhaseSignals): ActivePhase | null {
  const { messages, editDocumentType, editCallId, previewCallId, deployCallId } =
    signals;
  return useMemo(() => {
    if (!messages || !isResponding(messages)) return null;

    const candidates: { callId: string; phase: ActivePhase }[] = [];
    if (editCallId) {
      const phase = sectionForDocumentType(editDocumentType ?? "");
      if (phase) candidates.push({ callId: editCallId, phase });
    }
    if (previewCallId) candidates.push({ callId: previewCallId, phase: "build" });
    if (deployCallId) candidates.push({ callId: deployCallId, phase: "deploy" });

    let phase: ActivePhase | null = null;
    let bestIdx = -1;
    for (const c of candidates) {
      const idx = callIndex(messages, c.callId);
      if (idx > bestIdx) {
        bestIdx = idx;
        phase = c.phase;
      }
    }
    return phase;
  }, [messages, editDocumentType, editCallId, previewCallId, deployCallId]);
}

/**
 * The exact `documentType` the agent is editing right now (e.g.
 * `powerhouse/document-model`), or null. Like {@link useActivePhase} it requires
 * the agent to be responding, but returns the precise type — for contextual
 * "learn while you wait" lessons — and only while the edit is the most-recent
 * action (null once a preview/deploy supersedes it, i.e. the agent moved on).
 */
export function useActiveEditType(signals: ActivePhaseSignals): string | null {
  const { messages, editDocumentType, editCallId, previewCallId, deployCallId } =
    signals;
  return useMemo(() => {
    if (!messages || !isResponding(messages)) return null;
    if (!editCallId || !editDocumentType) return null;
    const editIdx = callIndex(messages, editCallId);
    const previewIdx = previewCallId ? callIndex(messages, previewCallId) : -1;
    const deployIdx = deployCallId ? callIndex(messages, deployCallId) : -1;
    if (editIdx < previewIdx || editIdx < deployIdx) return null;
    return editDocumentType;
  }, [messages, editDocumentType, editCallId, previewCallId, deployCallId]);
}
