type PhaseId = "ideate" | "specify" | "build" | "deploy";
type Phase = { id: PhaseId; label: string; note: string; enabled: boolean };

const PHASES: Phase[] = [
  { id: "ideate", label: "IDEATE", note: "Problem Definition", enabled: true },
  { id: "specify", label: "SPECIFY", note: "Solution Design", enabled: false },
  {
    id: "build",
    label: "BUILD",
    note: "Implementation & Testing",
    enabled: true,
  },
  { id: "deploy", label: "DEPLOY", note: "Delivery", enabled: false },
];

/** The product "home" overview: the four-phase cycle. IDEATE and BUILD are wired. */
export function PhaseCycle({
  onOpen,
}: {
  onOpen: (phase: "ideate" | "build") => void;
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-12">
      {PHASES.map((phase) => (
        <button
          key={phase.id}
          type="button"
          disabled={!phase.enabled}
          onClick={
            phase.id === "ideate" || phase.id === "build"
              ? () => onOpen(phase.id as "ideate" | "build")
              : undefined
          }
          className={`group relative flex items-center justify-between overflow-hidden rounded-xl border px-6 py-6 text-left transition ${
            phase.enabled
              ? "border-vetra-border bg-vetra-card hover:border-vetra-primary hover:shadow-sm"
              : "cursor-default border-vetra-border/50 bg-vetra-muted"
          }`}
        >
          {phase.enabled ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-vetra-primary to-transparent opacity-0 transition-opacity group-hover:opacity-60"
            />
          ) : null}
          <span className="text-xs font-semibold tracking-widest text-vetra-muted-fg">
            {phase.label}
          </span>
          <span
            className={`rounded-lg px-3 py-1 text-sm font-medium ${
              phase.enabled
                ? "bg-vetra-primary/10 text-vetra-primary"
                : "bg-vetra-muted/80 text-vetra-muted-fg"
            }`}
          >
            {phase.note}
          </span>
        </button>
      ))}
    </div>
  );
}
