type PhaseId = "ideate" | "specify" | "build" | "deploy";
type Phase = { id: PhaseId; label: string; note: string };

const PHASES: Phase[] = [
  { id: "ideate", label: "IDEATE", note: "Problem Definition" },
  { id: "specify", label: "SPECIFY", note: "Solution Design" },
  { id: "build", label: "BUILD", note: "Implementation & Testing" },
  { id: "deploy", label: "DEPLOY", note: "Delivery" },
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
        const id = phase.id;
        const open = isOpenablePhase(id) ? () => onOpen(id) : undefined;
        return (
          <button
            key={id}
            type="button"
            disabled={!open}
            onClick={open}
            className={`flex items-center justify-between rounded-lg border px-6 py-6 text-left transition ${
              open
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
        );
      })}
    </div>
  );
}
