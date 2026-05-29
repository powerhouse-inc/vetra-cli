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
          className={`flex items-center justify-between rounded-lg border px-6 py-6 text-left transition ${
            phase.enabled
              ? "border-gray-300 bg-white hover:border-gray-400 hover:shadow-sm"
              : "cursor-default border-gray-200 bg-gray-100"
          }`}
        >
          <span className="text-xs font-semibold tracking-widest text-gray-500">
            {phase.label}
          </span>
          <span className="rounded-md bg-yellow-100 px-3 py-1 text-sm text-gray-700 shadow-sm">
            {phase.note}
          </span>
        </button>
      ))}
    </div>
  );
}
