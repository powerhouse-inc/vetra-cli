/**
 * The steer box (spec §5.4, D10): the customer's message box at the bottom
 * of the story, always enabled while the agent builds. A steer is a normal
 * chat message — the agent picks it up at its next step — shown with its
 * delivery state (sent → seen by the agent): the box shows "Sent" until the
 * message reaches the conversation, then the story line carries it. Pause sits next to it: it stops
 * after the current step, and turns into Continue.
 */
import {
  actions as chatActions,
  type Message,
} from "@powerhousedao/clint-common/document-models/chat-session";
import { dispatchActions, usePHToast } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { actions as productActions } from "document-models/studio-product";
import { useEffect, useState, type RefObject } from "react";
import { NOT_DELIVERED_AFTER_MS, type Delivery } from "./storyModel.js";

export const STEER_PLACEHOLDER = 'Steer it: "make slides 16:9"…';

export const DELIVERY_TEXT: Record<Delivery, string> = {
  sent: "Sent",
  seen: "Seen by the agent",
  "not-delivered": "Not delivered yet",
};

/** Sends `text` as the customer's message in the conversation. */
export async function sendSteer(sessionId: string, text: string) {
  const id = generateId();
  await dispatchActions(
    chatActions.addUserMessage({
      id,
      content: [{ id: generateId(), type: "TEXT", text }],
      createdAt: new Date().toISOString(),
    }),
    sessionId,
  );
  return id;
}

export type SteerBoxProps = {
  /** The build's conversation; null until it exists. */
  sessionId: string | null;
  /** The product document (Pause / Continue). */
  productId: string | null;
  changeId: string;
  /** The change is paused (product document). */
  paused: boolean;
  /** The conversation's messages, for the delivery state. */
  messages: readonly Message[];
  now: Date;
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function SteerBox({
  sessionId,
  productId,
  changeId,
  paused,
  messages,
  now,
  inputRef,
}: SteerBoxProps) {
  const toast = usePHToast();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<{ id: string; at: Date } | null>(null);
  // Pause/Continue show at once; the product document confirms them.
  const [requested, setRequested] = useState<"pause" | "resume" | null>(null);

  useEffect(() => setRequested(null), [paused]);

  const showPaused =
    requested === "pause" ? true : requested === "resume" ? false : paused;

  // Until the message reaches the conversation (then the story shows its
  // delivery): sent, or not delivered after a minute.
  const delivery: Delivery | null =
    !sent || messages.some((m) => m.id === sent.id)
      ? null
      : now.getTime() - sent.at.getTime() > NOT_DELIVERED_AFTER_MS
        ? "not-delivered"
        : "sent";

  function send() {
    const message = text.trim();
    if (!message || !sessionId) return;
    setText("");
    const at = now;
    sendSteer(sessionId, message)
      .then((id) => setSent({ id, at }))
      .catch(() => {
        setText(message);
        toast?.("Couldn't send it. Try again.", { type: "error" });
      });
  }

  function togglePause() {
    if (!productId) return;
    const next = showPaused ? "resume" : "pause";
    const at = new Date().toISOString();
    const action =
      next === "pause"
        ? productActions.pauseChange({ changeId, at })
        : productActions.resumeChange({ changeId, at });
    setRequested(next);
    const failed = () => {
      setRequested(null);
      toast?.(
        next === "pause"
          ? "Couldn't pause. Try again."
          : "Couldn't continue. Try again.",
        { type: "error" },
      );
    };
    dispatchActions(action, productId, failed).catch(failed);
  }

  return (
    <div className="shrink-0 border-t border-border bg-card px-3 py-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!sessionId}
          placeholder={STEER_PLACEHOLDER}
          aria-label="Steer it"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
        />
        <button
          type="submit"
          disabled={!sessionId || !text.trim()}
          aria-label="Send"
          className="rounded-lg bg-vetra-primary px-2.5 py-1.5 text-xs font-medium text-vetra-primary-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          →
        </button>
        <button
          type="button"
          onClick={togglePause}
          disabled={!productId}
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showPaused ? "Continue" : "Pause"}
        </button>
      </form>
      {delivery ? (
        <p
          role="status"
          data-delivery={delivery}
          className={
            "mt-1 text-xs " +
            (delivery === "not-delivered"
              ? "text-amber-600"
              : "text-muted-foreground")
          }
        >
          {DELIVERY_TEXT[delivery]}
        </p>
      ) : null}
    </div>
  );
}
