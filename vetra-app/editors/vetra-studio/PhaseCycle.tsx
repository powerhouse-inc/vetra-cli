type Phase = { id: string; label: string; note: string; enabled: boolean };

const PHASES: Phase[] = [
  { id: "ideate", label: "IDEATE", note: "Problem Definition", enabled: true },
  { id: "specify", label: "SPECIFY", note: "Solution Design", enabled: false },
  {
    id: "build",
    label: "BUILD",
    note: "Implementation & Testing",
    enabled: false,
  },
  { id: "deploy", label: "DEPLOY", note: "Delivery", enabled: false },
];

/** The product "home" overview: the four-phase cycle. Only IDEATE is wired. */
export function PhaseCycle({ onOpenIdeate }: { onOpenIdeate: () => void }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-12">
      {PHASES.map((phase) => (
        <button
          key={phase.id}
          type="button"
          disabled={!phase.enabled}
          onClick={phase.enabled ? onOpenIdeate : undefined}
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
