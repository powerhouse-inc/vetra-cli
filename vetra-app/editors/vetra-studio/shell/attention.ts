import { useEffect, useRef } from "react";
import type { PHToastFn } from "@powerhousedao/reactor-browser";
import type { StoryLine } from "../story/storyModel.js";
import type { LayoutMode } from "./layoutPrefs.js";

/** One thing that waits for the customer. */
export type AttentionItem = { id: string; text: string };

/** The part of a strip failure that an attention item needs. */
export type AttentionFailure = {
  situation: string;
  text: string;
  messageId?: string;
};

/**
 * Everything that waits for the customer, whatever the layout: the agent's
 * open question, a step that needs them or stopped, a stuck step, and the
 * failure shown on the strip. Ids are stable across renders.
 */
export function attentionItems(
  lines: readonly StoryLine[],
  failure: AttentionFailure | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const line of lines) {
    if (line.kind === "reply" && line.question) {
      items.push({ id: line.id, text: line.text });
    } else if (line.kind === "attention") {
      items.push({ id: line.id, text: line.text });
    } else if (line.kind === "stuck") {
      items.push({ id: line.id, text: line.reason });
    }
  }
  if (failure) {
    items.push({
      id: `failure:${failure.situation}:${failure.messageId ?? ""}`,
      text: failure.text,
    });
  }
  return items;
}

/** Appended to every toast: the badge on the mode switch is the action. */
export const OPEN_CHAT_HINT = "Open chat to answer.";

/**
 * When the story is out of view (Demo, or Build once live with the drawer
 * closed), each item id not yet toasted toasts once, however
 * often the layout changes. While the story is in view nothing toasts.
 */
export function useAttentionToasts(
  items: readonly AttentionItem[],
  mode: LayoutMode,
  storyHidden: boolean,
  toast: PHToastFn | undefined,
): void {
  const seen = useRef(new Set<string>());
  const hidden = mode === "demo" || storyHidden;
  useEffect(() => {
    if (!hidden || !toast) return;
    for (const item of items) {
      if (seen.current.has(item.id)) continue;
      seen.current.add(item.id);
      toast(`${item.text} ${OPEN_CHAT_HINT}`, { type: "warning" });
    }
  }, [items, hidden, toast]);
}
