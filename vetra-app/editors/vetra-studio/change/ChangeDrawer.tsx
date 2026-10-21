/**
 * The change drawer (spec §5.6–§5.7), right side, ~40 %: opened from the
 * "Change something" bubble. With no change open it asks "What should
 * change?" — the agent's suggestions as chips that fill the box (editable
 * before sending) — over the past changes grouped by version. Once a change
 * is open the drawer becomes that change's story; after it went live it says
 * "Version <n> is live.".
 */
import type { StudioProductState } from "document-models/studio-product";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  CHANGE_SOMETHING,
  CLOSE,
  DISCARDED,
  SEND,
  WHAT_SHOULD_CHANGE,
  startFailureText,
  versionIsLive,
} from "./changeCopy.js";
import { changeHistory, openSuggestions } from "./changeHistory.js";

export function ChangeDrawer({
  product,
  story,
  launchedVersion,
  onStart,
  onClose,
  containerRef,
}: {
  /** Normalised product state (`readProduct`). */
  product: StudioProductState;
  /** The open change's story; null when no change is open. */
  story: ReactNode | null;
  /** The version the last change made live, while the drawer says so. */
  launchedVersion: number | null;
  /** Starts the change (`startChange`); rejects when it couldn't. */
  onStart: (request: string) => Promise<unknown>;
  onClose: () => void;
  containerRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <aside
      ref={containerRef}
      aria-label={CHANGE_SOMETHING}
      data-drawer="change"
      className="flex w-[40%] min-w-72 max-w-xl shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold text-foreground">
          {CHANGE_SOMETHING}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={CLOSE}
          title={CLOSE}
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      {story ? (
        <div className="flex min-h-0 flex-1 flex-col">{story}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {launchedVersion !== null ? (
            <p
              role="status"
              data-launched
              className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-semibold text-foreground"
            >
              {versionIsLive(launchedVersion)}
            </p>
          ) : null}
          <ChangeRequest product={product} onStart={onStart} />
          <PastChanges product={product} />
        </div>
      )}
    </aside>
  );
}

/** "What should change?" with the agent's suggestions under it. */
export function ChangeRequest({
  product,
  onStart,
}: {
  product: StudioProductState;
  onStart: (request: string) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestions = openSuggestions(product);

  function send() {
    const request = text.trim();
    if (!request || sending) return;
    setSending(true);
    setError(null);
    onStart(request).then(
      () => {
        setSending(false);
        setText("");
      },
      (err: unknown) => {
        setSending(false);
        setError(startFailureText(err));
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
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
          placeholder={WHAT_SHOULD_CHANGE}
          aria-label={WHAT_SHOULD_CHANGE}
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="rounded-lg bg-vetra-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {SEND}
        </button>
      </form>
      {suggestions.length > 0 ? (
        <ul aria-label="Suggestions" className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                data-suggestion={s.id}
                onClick={() => {
                  // Fills the box only: the customer can edit it, then send.
                  setText(s.text);
                  inputRef.current?.focus();
                }}
                className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-foreground hover:bg-accent"
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Past changes, grouped by version (newest first). */
function PastChanges({ product }: { product: StudioProductState }) {
  const groups = changeHistory(product);
  if (groups.length === 0) return null;
  return (
    <ol className="flex flex-col gap-3">
      {groups.map((group) => (
        <li key={group.version} data-version={group.version}>
          <h3 className="text-xs font-semibold text-foreground">
            {group.heading}
          </h3>
          {group.entries.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {group.entries.map((e) => (
                <li
                  key={e.changeId}
                  data-change={e.changeId}
                  data-discarded={e.discarded || undefined}
                  className="text-xs text-muted-foreground"
                >
                  <span className={e.discarded ? "line-through" : undefined}>
                    “{e.text}”
                  </span>
                  {e.discarded ? <span> · {DISCARDED}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The "💬 Change something" bubble, bottom-right over the live product. */
export function ChangeBubble({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      data-bubble="change"
      onClick={onOpen}
      className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg hover:bg-accent"
    >
      <span aria-hidden>💬</span>
      {CHANGE_SOMETHING}
    </button>
  );
}
