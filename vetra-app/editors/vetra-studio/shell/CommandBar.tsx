import { usePHToast } from "@powerhousedao/reactor-browser";
import { useEffect, useRef, useState } from "react";
import { COMMAND_INPUT_ATTR } from "./commandKeys.js";

export const COMMAND_PLACEHOLDER = "Ask for a change…";

export type CommandBarProps = {
  open: boolean;
  onClose: () => void;
  /** Sends through the story's own path (the open change, else a new one). */
  onSend: (text: string) => Promise<void>;
  /** The newest agent reply; shown as a toast when it arrives. */
  lastReply: string | null;
  /** The agent's open question, shown over the input. */
  pending: string | null;
};

/**
 * Demo's chat: one input (⌘K / Ctrl-K), Enter sends, Esc closes. The last
 * agent reply arrives as a toast, open or not.
 */
export function CommandBar({
  open,
  onClose,
  onSend,
  lastReply,
  pending,
}: CommandBarProps) {
  const toast = usePHToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(lastReply);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (lastReply === seen.current) return;
    seen.current = lastReply;
    if (lastReply) toast?.(lastReply, { type: "info" });
  }, [lastReply, toast]);

  // After a failed send the input is enabled again: put the cursor back.
  useEffect(() => {
    if (error && !busy) field.current?.focus();
  }, [error, busy]);

  if (!open) return null;

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(value);
      setText("");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't send. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-command-bar
      role="dialog"
      aria-label="Command bar"
      className="absolute inset-x-0 top-12 z-40 mx-auto w-full max-w-xl px-4"
    >
      <div className="rounded-lg border border-border bg-card p-2 shadow-lg">
        {pending ? (
          <p className="mb-2 whitespace-pre-wrap rounded bg-vetra-primary/5 px-2 py-1 text-sm text-foreground">
            {pending}
          </p>
        ) : null}
        <input
          {...{ [COMMAND_INPUT_ATTR]: "" }}
          autoFocus
          ref={field}
          aria-label="Ask for a change"
          placeholder={COMMAND_PLACEHOLDER}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          className="w-full bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        {error ? (
          <p role="alert" className="px-2 pt-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
