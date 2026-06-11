import { FileText, Hammer, Lightbulb, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type PhaseId = "ideate" | "specify" | "build" | "deploy";
type Phase = { id: PhaseId; label: string; note: string; Icon: LucideIcon };

const PHASES: Phase[] = [
  { id: "ideate", label: "IDEATE", note: "Problem Definition", Icon: Lightbulb },
  { id: "specify", label: "SPECIFY", note: "Solution Design", Icon: FileText },
  { id: "build", label: "BUILD", note: "Implementation & Testing", Icon: Hammer },
  { id: "deploy", label: "DEPLOY", note: "Delivery", Icon: Rocket },
];

type OpenablePhase = "ideate" | "specify" | "build";

/** Single source of phase availability: a tile is enabled exactly when the
 * studio has a section for it. */
function isOpenablePhase(id: PhaseId): id is OpenablePhase {
  return id === "ideate" || id === "specify" || id === "build";
}

/** The product "home" overview: the four-phase cycle. */
export function PhaseCycle({
  onOpen,
}: {
  onOpen: (phase: OpenablePhase) => void;
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-12">
      {PHASES.map((phase) => {
        const { id, Icon } = phase;
        const open = isOpenablePhase(id) ? () => onOpen(id) : undefined;
        return (
          <button
            key={id}
            type="button"
            disabled={!open}
            onClick={open}
            className={`group relative flex items-center justify-between overflow-hidden rounded-xl border px-6 py-6 text-left transition ${
              open
                ? "border-vetra-border bg-vetra-card hover:border-vetra-primary hover:shadow-sm"
                : "cursor-default border-vetra-border/50 bg-vetra-muted"
            }`}
          >
            {open ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-vetra-primary to-transparent opacity-0 transition-opacity group-hover:opacity-60"
              />
            ) : null}
            <span className="flex items-center gap-2.5">
              <Icon
                size={15}
                className={open ? "text-vetra-primary" : "text-vetra-muted-fg"}
              />
              <span className="text-xs font-semibold tracking-widest text-vetra-muted-fg">
                {phase.label}
              </span>
            </span>
            <span
              className={`rounded-lg px-3 py-1 text-sm font-medium ${
                open
                  ? "bg-vetra-primary/10 text-vetra-primary"
                  : "bg-vetra-muted/80 text-vetra-muted-fg"
              }`}
            >
              {phase.note}
            </span>
          </button>
        );
      })}
    </div>
  );
}
