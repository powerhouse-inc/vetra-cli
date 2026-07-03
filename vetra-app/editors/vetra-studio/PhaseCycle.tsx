import { useEffect, useState } from "react";
import {
  Check,
  Compass,
  Copy,
  FileText,
  Hammer,
  Lightbulb,
  Rocket,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type PhaseId = "ideate" | "specify" | "build" | "deploy";
type Phase = {
  id: PhaseId;
  label: string;
  note: string;
  Icon: LucideIcon;
  description: string;
};

const PHASES: Phase[] = [
  {
    id: "ideate",
    label: "IDEATE",
    note: "Problem Definition",
    Icon: Lightbulb,
    description:
      "Frame the problem and who it's for — the agent turns a rough idea into a clear product brief.",
  },
  {
    id: "specify",
    label: "SPECIFY",
    note: "Solution Design",
    Icon: FileText,
    description:
      "Pin down how it works — the data model, workflow, and states the agent designs and builds against.",
  },
  {
    id: "build",
    label: "BUILD",
    note: "Implementation & Testing",
    Icon: Hammer,
    description:
      "Watch the agent generate and test the code, with a live preview of the running app.",
  },
  {
    id: "deploy",
    label: "DEPLOY",
    note: "Delivery",
    Icon: Rocket,
    description:
      "Ship it to the cloud — publish the package and run it in your environments.",
  },
];

/** Example prompts shown at the top of the flow to seed a new product;
 * cycled so visitors see a few different shapes of idea. */
const EXAMPLE_PROMPTS = [
  "Develop the product specifications for a breakfast ordering system for a hotel restaurant. Guests will scan a QR code at their table and then enter their breakfast preferences. Hotel staff have a daily kanban-style queue to move orders from menu_setup, draft, requested, in progress, ready, to completed or cancelled.",
  "Build a maintenance request tracker for a property manager. Tenants submit issues with a photo and priority, and the manager triages them through new, scheduled, in progress, and resolved — assigning each to a contractor along the way.",
  "Design an invoice approval workflow for a finance team. Employees upload expenses, a reviewer approves or rejects with a note, and approved invoices move to a paid queue with a running total per department.",
] as const;

/** Rotate the example prompt on a fixed interval, pausing while the user hovers. */
const PROMPT_ROTATE_MS = 20_000;

/** Example prompt card that rotates through {@link EXAMPLE_PROMPTS} and reveals
 * a copy button on hover. */
function ExamplePrompt() {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [paused, setPaused] = useState(false);
  const prompt = EXAMPLE_PROMPTS[index];

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % EXAMPLE_PROMPTS.length);
    }, PROMPT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const copy = () => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      data-tour="example-prompt"
      className="group relative rounded-lg border border-border bg-accent px-3 pb-7 pt-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <p className="text-xs italic text-muted-foreground">
        <span className="mr-1.5 font-semibold not-italic uppercase tracking-wide text-muted-foreground/80">
          Example
        </span>
        {prompt}
      </p>

      <div className="absolute bottom-2 left-3 flex items-center gap-1.5">
        {EXAMPLE_PROMPTS.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show example prompt ${i + 1} of ${EXAMPLE_PROMPTS.length}`}
            aria-current={i === index}
            className={`h-1.5 rounded-full transition-all ${
              i === index
                ? "w-4 bg-vetra-primary"
                : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground"
            }`}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={copy}
        aria-label="Copy example prompt"
        className="absolute bottom-1.5 right-2 rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

type OpenablePhase = "ideate" | "specify" | "build" | "deploy";

/** Single source of phase availability: a tile is enabled exactly when the
 * studio has a section for it. */
function isOpenablePhase(id: PhaseId): id is OpenablePhase {
  return (
    // TODO: deploy should be openable only when there's something built, otherwise it doesn't make sense
    id === "ideate" || id === "specify" || id === "build" || id === "deploy"
  );
}

/** The product "home" overview: example prompts to get started, then the
 * four-phase product design flow as a numbered vertical timeline. `activePhase`
 * softly pulses the phase the agent is currently working on. */
export function PhaseCycle({
  onOpen,
  onStartTour,
  activePhase,
}: {
  onOpen: (phase: OpenablePhase) => void;
  onStartTour?: () => void;
  activePhase?: OpenablePhase | null;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-8 py-12">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            Product development cycle
          </h2>
          {onStartTour ? (
            <button
              type="button"
              onClick={onStartTour}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-vetra-primary hover:text-vetra-primary"
            >
              <Compass size={14} />
              Take a tour
            </button>
          ) : null}
        </div>
        <ExamplePrompt />
      </div>

      <ol data-tour="flow" className="isolate flex flex-col gap-5">
        {PHASES.map((phase, i) => {
          const { id, Icon } = phase;
          const open = isOpenablePhase(id) ? () => onOpen(id) : undefined;
          const last = i === PHASES.length - 1;
          const active = id === activePhase;
          return (
            <li key={id} className="group flex items-stretch gap-5">
              <span className="relative flex w-9 shrink-0 justify-center">
                {!last ? (
                  <span
                    aria-hidden
                    className="absolute -bottom-9 left-1/2 top-4 w-px -translate-x-1/2 bg-border"
                  />
                ) : null}
                <span
                  className={`relative mt-4 flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition ${
                    active
                      ? "animate-phase-pulse border-vetra-primary bg-vetra-primary/10 text-vetra-primary"
                      : open
                        ? "border-border bg-accent text-foreground group-hover:border-vetra-primary group-hover:text-vetra-primary"
                        : "border-border/50 bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
              </span>

              <button
                type="button"
                data-tour={`phase-${id}`}
                disabled={!open}
                onClick={open}
                className={`flex flex-1 flex-col gap-1.5 rounded-xl border px-5 py-4 text-left transition ${
                  open
                    ? "border-border bg-card group-hover:border-vetra-primary group-hover:shadow-sm"
                    : "cursor-default border-border/50 bg-muted"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    size={15}
                    className={
                      open ? "text-vetra-primary" : "text-muted-foreground"
                    }
                  />
                  <span className="text-xs font-semibold tracking-widest text-muted-foreground">
                    {phase.label}
                  </span>
                  <span
                    className={`ml-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                      open
                        ? "bg-vetra-primary/10 text-vetra-primary"
                        : "bg-muted/80 text-muted-foreground"
                    }`}
                  >
                    {phase.note}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {phase.description}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
