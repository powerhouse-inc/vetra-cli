/**
 * The "Change this" popover (P4-M3, Task 3.3): anchored at the pointed
 * element, the customer says what should change and Send steers it into the
 * open change (or starts one). The screenshot rides along when it saved.
 */
import { useState } from "react";
import type { PointTarget } from "./pointTarget.js";

export const CHANGE_THIS = "Change this";
export const WHAT_SHOULD_CHANGE = "What should change here?";
export const SHOT_ATTACHED = "Screenshot attached";

export type ChangeThisProps = {
  /** The element, with its rect already in the pane's coordinates. */
  target: PointTarget;
  shot: Blob | null;
  onSend: (text: string) => Promise<void>;
  onCancel: () => void;
  /** Text already in the box (a text edit that went to the agent). */
  initialText?: string;
};

/** The pointed element's request box. */
export function ChangeThis({
  target,
  shot,
  onSend,
  onCancel,
  initialText = "",
}: ChangeThisProps) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(value);
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
      data-change-this
      role="dialog"
      aria-label={CHANGE_THIS}
      className="absolute z-30 w-72 rounded-lg border border-border bg-card p-3 text-left shadow-lg"
      style={{ left: target.rect.x, top: target.rect.y }}
    >
      <p className="text-sm font-semibold text-foreground">{CHANGE_THIS}</p>
      {target.text ? (
        <p
          data-change-this-text
          className="mt-1 line-clamp-2 text-xs text-muted-foreground"
        >
          “{target.text}”
        </p>
      ) : null}
      <textarea
        aria-label={WHAT_SHOULD_CHANGE}
        placeholder={WHAT_SHOULD_CHANGE}
        value={text}
        disabled={busy}
        rows={3}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        className="mt-2 w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-vetra-primary"
      />
      {shot ? (
        <p
          data-change-this-shot
          className="mt-1 text-[11px] text-muted-foreground"
        >
          {SHOT_ATTACHED}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!text.trim() || busy}
          className="rounded-full bg-vetra-primary px-2.5 py-0.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
