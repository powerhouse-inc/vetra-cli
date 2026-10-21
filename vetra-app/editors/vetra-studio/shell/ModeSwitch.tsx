import type { Dock, LayoutMode } from "./layoutPrefs.js";

const MODES: readonly { value: LayoutMode; label: string }[] = [
  { value: "build", label: "Build" },
  { value: "review", label: "Review" },
  { value: "demo", label: "Demo" },
];

const DOCKS: readonly { value: Dock; label: string }[] = [
  { value: "left", label: "Chat on the left" },
  { value: "right", label: "Chat on the right" },
  { value: "bottom", label: "Chat on the bottom" },
];

function isDock(value: string): value is Dock {
  return DOCKS.some((d) => d.value === value);
}

/**
 * Build | Review | Demo in one click (spec G2), the chat's side in Build and
 * Review, and how many things wait for the customer (seen when the story is
 * out of view).
 */
export function ModeSwitch({
  mode,
  onMode,
  dock,
  onDock,
  attention,
}: {
  mode: LayoutMode;
  onMode: (mode: LayoutMode) => void;
  dock: Dock;
  onDock: (dock: Dock) => void;
  attention: number;
}) {
  return (
    <div data-mode-switch className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Layout"
        className="inline-flex rounded-full border border-border bg-muted p-0.5"
      >
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-medium " +
              (mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {attention > 0 ? (
        <span
          data-attention
          title="Waiting for you"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-semibold tabular-nums text-white"
        >
          {attention}
        </span>
      ) : null}
      {mode === "demo" ? null : (
        <select
          aria-label="Chat position"
          value={dock}
          onChange={(e) => {
            const next = e.target.value;
            if (isDock(next)) onDock(next);
          }}
          className="rounded-lg border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
        >
          {DOCKS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
