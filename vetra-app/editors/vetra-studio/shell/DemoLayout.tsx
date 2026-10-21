import { useEffect, useRef, useState, type ReactNode } from "react";
import { CommandBar } from "./CommandBar.js";
import { isCommandShortcut, isMacPlatform } from "./commandKeys.js";

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
  const productRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const platform = navigator.platform;
    const onKey = (e: KeyboardEvent) => {
      if (!isCommandShortcut(e, platform)) return;
      e.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    // A same-origin product frame (the preview) is its own document: its
    // keys never reach this window, so listen on it too. A cross-origin
    // frame (the live app) refuses access, and the visible trigger remains.
    const hooked = new Map<HTMLIFrameElement, Window>();
    const detach = (frame: HTMLIFrameElement) => {
      hooked.get(frame)?.removeEventListener("keydown", onKey);
      hooked.delete(frame);
    };
    const attach = (frame: HTMLIFrameElement) => {
      detach(frame);
      try {
        const win = frame.contentWindow;
        if (!win) return;
        void win.document.body; // throws when cross-origin
        win.addEventListener("keydown", onKey);
        hooked.set(frame, win);
      } catch {
        /* cross-origin: nothing to listen on */
      }
    };
    const root = productRef.current;
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLIFrameElement) attach(e.target);
    };
    root?.addEventListener("load", onLoad, true);
    root?.querySelectorAll("iframe").forEach(attach);
    return () => {
      window.removeEventListener("keydown", onKey);
      root?.removeEventListener("load", onLoad, true);
      for (const frame of [...hooked.keys()]) detach(frame);
    };
  }, []);
  const hint = isMacPlatform(navigator.platform) ? "⌘K" : "Ctrl K";

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
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full border border-border px-3 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            <span>Ask for a change…</span>
            <kbd className="rounded bg-muted px-1 text-[10px]">{hint}</kbd>
          </button>
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
        ref={productRef}
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
