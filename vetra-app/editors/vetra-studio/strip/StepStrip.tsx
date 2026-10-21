import type { StepKind } from "document-models/studio-product";
import { useRef, useState } from "react";
import type { StepIcon, StripStep, StripView } from "./stripModel.js";

/**
 * Step colours (spec §5.2, mockup): ✓ done green, ◐ working yellow
 * (mockup #f0c75e), ! needs you amber (filled, so it never reads as
 * working), ✕ stopped red, ● Live solid green, ○ grey. Never colour alone:
 * every pill also carries its glyph and state word.
 */
export function tone(icon: StepIcon): string {
  switch (icon) {
    case "✓":
      return "border-success/40 bg-success/10 text-success";
    case "◐":
      return "border-yellow-500/40 bg-yellow-400/15 text-yellow-600";
    case "!":
      return "border-warning bg-warning text-white";
    case "✕":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "●":
      return "border-success bg-success text-white";
    case "○":
      return "border-border bg-card text-muted-foreground";
  }
}

function StepPill({
  step,
  selected,
  onOpen,
}: {
  step: StripStep;
  selected: boolean;
  onOpen: (kind: StepKind) => void;
}) {
  const className = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone(step.icon)}`;
  const content = (
    <>
      <span aria-hidden className={step.icon === "◐" ? "animate-pulse" : ""}>
        {step.icon}
      </span>
      <span>{step.label}</span>
      {step.count ? <span className="tabular-nums">{step.count}</span> : null}
      <span className="sr-only">— {step.stateText}</span>
    </>
  );
  if (!step.clickable) {
    return (
      <span data-step={step.kind} className={`${className} opacity-80`}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-step={step.kind}
      aria-pressed={selected}
      title={`${step.label} — ${step.stateText}`}
      onClick={() => onOpen(step.kind)}
      className={`${className} hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-vetra-primary ${selected ? "ring-2 ring-vetra-primary/50" : ""}`}
    >
      {content}
    </button>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className="h-4 w-4">
      <path
        d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.2-1.7.6a5 5 0 0 0-1.7-1L9.3 1.5H6.7l-.3 1.8a5 5 0 0 0-1.7 1l-1.7-.6-1.3 2.2L3.1 7a5 5 0 0 0 0 2l-1.4 1.1 1.3 2.2 1.7-.6a5 5 0 0 0 1.7 1l.3 1.8h2.6l.3-1.8a5 5 0 0 0 1.7-1l1.7.6 1.3-2.2L12.9 9c.1-.3.1-.7.1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The product name, editable in place ("Name ✎", spec §5.1): Enter or
 * leaving the field saves, Escape cancels. Renaming never changes the web
 * address.
 */
function ProductName({
  name,
  onRename,
}: {
  name: string;
  onRename?: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Set once the edit ends, so a blur after Enter/Escape doesn't save again.
  const closed = useRef(false);
  const nameClass = "max-w-64 truncate text-sm font-semibold text-foreground";
  if (!onRename) return <span className={nameClass}>{name}</span>;

  if (draft === null) {
    return (
      <button
        type="button"
        aria-label="Rename"
        title="Rename"
        onClick={() => {
          closed.current = false;
          setDraft(name);
        }}
        className={`${nameClass} rounded px-1 hover:bg-accent`}
      >
        {name}{" "}
        <span aria-hidden className="text-muted-foreground">
          ✎
        </span>
      </button>
    );
  }

  function save() {
    if (closed.current) return;
    closed.current = true;
    const next = (draft ?? "").trim();
    setDraft(null);
    if (onRename && next && next !== name) onRename(next);
  }

  return (
    <input
      aria-label="Product name"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closed.current = true;
          setDraft(null);
        }
      }}
      className="w-56 rounded border border-border bg-background px-1.5 py-0.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-vetra-primary"
    />
  );
}

/** The Settings control (account menu entry point). */
export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Settings"
      title="Settings"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <GearIcon />
    </button>
  );
}

/**
 * The step strip (spec §5.1/§5.2): product name, the five steps — the only
 * navigation on the page — and budget/time left or the live address.
 */
export function StepStrip({
  view,
  selected,
  onOpenStep,
  onOpenSettings,
  onRename,
}: {
  view: StripView;
  selected: StepKind | null;
  onOpenStep: (kind: StepKind) => void;
  onOpenSettings: () => void;
  /** Renames the product; the name is read-only without it. */
  onRename?: (name: string) => void;
}) {
  const right = view.right;
  return (
    <header
      aria-label="Steps"
      className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-card px-4 py-2"
    >
      <ProductName name={view.name} onRename={onRename} />
      <ol className="flex flex-wrap items-center gap-1.5">
        {view.steps.map((step) => (
          <li key={step.kind}>
            <StepPill
              step={step}
              selected={selected === step.kind}
              onOpen={onOpenStep}
            />
          </li>
        ))}
      </ol>
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        {"liveUrl" in right ? (
          <>
            <a
              href={right.liveUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-vetra-primary hover:underline"
            >
              {right.liveUrl.replace(/^https?:\/\//, "")} ↗
            </a>
            <span>
              {right.deployedAgo} · {right.github}
            </span>
          </>
        ) : (
          <span className="tabular-nums">
            {[right.budget, right.timeLeft].filter(Boolean).join(" · ")}
          </span>
        )}
        <SettingsButton onOpen={onOpenSettings} />
      </div>
    </header>
  );
}
