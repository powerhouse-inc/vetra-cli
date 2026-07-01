import { Compass, FileText, Hammer, Lightbulb, Rocket } from "lucide-react";
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

/** Example prompt shown at the top of the flow to seed a new product. */
const EXAMPLE_PROMPT =
  "Develop the product specifications for a breakfast ordering system for a hotel restaurant. Guests will scan a QR code at their table and then enter their breakfast preferences. Hotel staff have a daily kanban-style queue to move orders from menu_setup, draft, requested, in progress, ready, to completed or cancelled.";

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
 * four-phase product design flow as a numbered vertical timeline. */
export function PhaseCycle({
  onOpen,
  onStartTour,
}: {
  onOpen: (phase: OpenablePhase) => void;
  onStartTour?: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-8 py-12">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-vetra-fg">
            Product design flow
          </h2>
          {onStartTour ? (
            <button
              type="button"
              onClick={onStartTour}
              className="flex items-center gap-1.5 rounded-md border border-vetra-border bg-vetra-card px-2.5 py-1 text-xs font-medium text-vetra-fg transition-colors hover:border-vetra-primary hover:text-vetra-primary"
            >
              <Compass size={14} />
              Take a tour
            </button>
          ) : null}
        </div>
        <p className="rounded-lg border border-vetra-border bg-vetra-accent px-3 py-2 text-xs italic text-vetra-muted-fg">
          <span className="mr-1.5 font-semibold not-italic uppercase tracking-wide text-vetra-muted-fg/80">
            Example
          </span>
          {EXAMPLE_PROMPT}
        </p>
      </div>

      <ol data-tour="flow" className="flex flex-col">
        {PHASES.map((phase, i) => {
          const { id, Icon } = phase;
          const open = isOpenablePhase(id) ? () => onOpen(id) : undefined;
          const last = i === PHASES.length - 1;
          return (
            <li key={id}>
              <button
                type="button"
                data-tour={`phase-${id}`}
                disabled={!open}
                onClick={open}
                className={`group flex w-full items-stretch gap-4 text-left ${
                  open ? "" : "cursor-default"
                }`}
              >
                <span className="relative flex w-9 shrink-0 justify-center">
                  {!last ? (
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-1/2 top-9 w-px -translate-x-1/2 bg-vetra-border"
                    />
                  ) : null}
                  <span
                    className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition ${
                      open
                        ? "border-vetra-border bg-vetra-card text-vetra-fg group-hover:border-vetra-primary group-hover:text-vetra-primary"
                        : "border-vetra-border/50 bg-vetra-muted text-vetra-muted-fg"
                    }`}
                  >
                    {i + 1}
                  </span>
                </span>

                <span
                  className={`flex flex-1 flex-col gap-1.5 ${last ? "" : "pb-8"}`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon
                      size={15}
                      className={
                        open ? "text-vetra-primary" : "text-vetra-muted-fg"
                      }
                    />
                    <span className="text-xs font-semibold tracking-widest text-vetra-muted-fg">
                      {phase.label}
                    </span>
                    <span
                      className={`ml-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                        open
                          ? "bg-vetra-primary/10 text-vetra-primary"
                          : "bg-vetra-muted/80 text-vetra-muted-fg"
                      }`}
                    >
                      {phase.note}
                    </span>
                  </span>
                  <span className="text-sm text-vetra-muted-fg">
                    {phase.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
