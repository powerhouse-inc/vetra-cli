import { useEffect, useState, type ReactNode } from "react";
import { CommandBar } from "./CommandBar.js";
import { isCommandShortcut } from "./commandKeys.js";

export type DemoLayoutProps = {
  /** The live view or the preview, full screen. */
  product: ReactNode;
  name: string;
  live: boolean;
  /** Returns to Review. */
  onOpenChat: () => void;
  /** The mode switch (with its attention badge). */
  modeSwitch: ReactNode;
  onSend: (text: string) => Promise<void>;
  lastReply: string | null;
  /** The agent's open question; always in view. */
  question: string | null;
};

/**
 * Demo mode (spec G2): the product full screen under a thin bar; the chat is
 * the ⌘K / Ctrl-K command bar.
 */
export function DemoLayout({
  product,
  name,
  live,
  onOpenChat,
  modeSwitch,
  onSend,
  lastReply,
  question,
}: DemoLayoutProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isCommandShortcut(e, navigator.platform)) return;
      e.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        data-demo-bar
        className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1"
      >
        <span className="max-w-64 truncate text-sm font-semibold text-foreground">
          {name}
        </span>
        {live ? (
          <span
            aria-label="Live"
            title="Live"
            className="size-2 rounded-full bg-emerald-500"
          />
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenChat}
            className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Open chat
          </button>
          {modeSwitch}
        </div>
      </div>
      {question && !open ? (
        <p
          data-demo-question
          className="whitespace-pre-wrap border-b border-vetra-primary/40 bg-vetra-primary/5 px-4 py-2 text-sm text-foreground"
        >
          {question}
        </p>
      ) : null}
      <div
        data-demo-product
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      >
        {product}
      </div>
      <CommandBar
        open={open}
        onClose={() => setOpen(false)}
        onSend={onSend}
        lastReply={lastReply}
        pending={question}
      />
    </div>
  );
}
