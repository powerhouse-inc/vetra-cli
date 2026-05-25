type StepId = "ideate" | "specify" | "build" | "deploy";

const STEPS: { id: StepId; label: string }[] = [
  { id: "ideate", label: "IDEATE" },
  { id: "specify", label: "SPECIFY" },
  { id: "build", label: "BUILD" },
  { id: "deploy", label: "DEPLOY" },
];

export type WorkflowScaffoldProps = {
  selectedSessionId: string | undefined;
  /** URL the BUILD step iframe loads. When omitted, the step renders an
   *  empty placeholder. Will be supplied by the workflow registry once
   *  the agent points the session at a reactor-project preview document. */
  buildPreviewUrl?: string;
};

export function WorkflowScaffold({
  selectedSessionId,
  buildPreviewUrl,
}: WorkflowScaffoldProps) {
  if (!selectedSessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Start a session to see the workflow.
      </div>
    );
  }

  const hasPreview = Boolean(buildPreviewUrl);

  /* When BUILD has a real preview we surrender almost all vertical space to
   * the iframe, but keep a thin progress strip on top so the user still sees
   * where they are in the four-step flow. Step state is hardcoded to "build"
   * for now; the workflow registry will drive it for real later. */
  if (hasPreview) {
    return (
      <div className="flex h-full w-full flex-col">
        <ProgressBar currentStep="build" />
        <iframe
          src={buildPreviewUrl}
          title="Preview"
          className="block min-h-0 w-full flex-1 border-0"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-8 py-12">
      {STEPS.map((step) => (
        <StepCard key={step.id} label={step.label} />
      ))}
    </div>
  );
}

function ProgressBar({ currentStep }: { currentStep: StepId }) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);
  return (
    <ol className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
      {STEPS.map((step, index) => {
        const state =
          index < currentIndex
            ? "done"
            : index === currentIndex
              ? "active"
              : "todo";
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={
                "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tracking-wider " +
                (state === "active"
                  ? "bg-gray-900 text-white"
                  : state === "done"
                    ? "bg-gray-200 text-gray-700"
                    : "border border-dashed border-gray-300 text-gray-400")
              }
            >
              {state === "done" ? "✓" : index + 1}
            </span>
            <span
              className={
                "text-[11px] font-medium tracking-wider " +
                (state === "active"
                  ? "text-gray-900"
                  : state === "done"
                    ? "text-gray-600"
                    : "text-gray-400")
              }
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden
                className={
                  "ml-1 h-px w-6 " +
                  (state === "done" ? "bg-gray-400" : "bg-gray-200")
                }
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-100 px-6 py-5">
      <span className="text-xs font-semibold tracking-wider text-gray-500">
        {label}
      </span>
    </div>
  );
}
