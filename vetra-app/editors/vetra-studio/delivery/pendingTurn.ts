/**
 * Retries the agent's turn automatically for a message that is in the
 * conversation but was not picked up — the first prompt is written into the
 * session document while the Studio's chat runtime is restarting (a model-key
 * roll), so the restarted watcher never sees it and "Not delivered yet · Retry"
 * is the only way forward.
 *
 * Once the daemon answers again (`waitForChatReady`), `RETRY_TURN` is
 * dispatched for that message, so the customer doesn't have to press Retry.
 * Each message is retried once automatically; the manual Retry stays as the
 * fallback when the runtime does not come back or the dispatch is refused.
 */
import type { Message } from "@powerhousedao/clint-common/document-models/chat-session";
import { useEffect, useRef, useState } from "react";
import { deliveryOf, type StoryChat } from "../story/storyModel.js";
import { waitForChatReady } from "./chatReadiness.js";

/** The newest message the agent hasn't picked up after the story's threshold. */
export function pendingTurnOf(
  chat: StoryChat | null,
  now: Date,
): Message | null {
  const messages = chat?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "USER") continue;
    if (deliveryOf(messages, i, now) === "not-delivered") {
      return messages[i];
    }
  }
  return null;
}

export type PendingTurnOptions = {
  /** Off turns the automatic retry off (the tests, a host without a daemon). */
  enabled?: boolean;
  /** Resolves when the chat runtime can take the turn; default: `/healthz`. */
  waitUntilReady?: () => Promise<boolean>;
};

export type PendingTurnRetry = {
  /** The message waiting for the agent, once it is overdue. */
  pending: Message | null;
  /** The automatic retry is waiting for the chat runtime to answer. */
  retrying: boolean;
};

export function usePendingTurnRetry(
  chat: StoryChat | null,
  now: Date,
  retryTurn: (messageId: string) => void | Promise<void>,
  {
    enabled = true,
    waitUntilReady = waitForChatReady,
  }: PendingTurnOptions = {},
): PendingTurnRetry {
  const pending = pendingTurnOf(chat, now);
  const id = pending?.id ?? null;
  /** Message ids this hook already retried; a rerender never doubles a turn. */
  const retried = useRef(new Set<string>());
  const retryRef = useRef(retryTurn);
  retryRef.current = retryTurn;
  const [retrying, setRetrying] = useState(false);
  /** The wait ended without a retry: the manual Retry takes over. */
  const [givenUp, setGivenUp] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) {
      setRetrying(false);
      return;
    }
    if (!enabled || retried.current.has(id) || givenUp === id) {
      setRetrying(false);
      return;
    }
    let live = true;
    setRetrying(true);
    void waitUntilReady()
      .catch(() => false)
      .then((ready) => {
        if (!live) return;
        setRetrying(false);
        if (!ready) {
          setGivenUp(id);
          return;
        }
        if (retried.current.has(id)) return;
        retried.current.add(id);
        void Promise.resolve(retryRef.current(id)).catch(() => setGivenUp(id));
      });
    return () => {
      live = false;
    };
  }, [id, enabled, waitUntilReady, givenUp]);

  return { pending, retrying };
}
