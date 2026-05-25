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

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-8 py-12">
      {STEPS.map((step) => (
        <StepCard
          key={step.id}
          label={step.label}
          buildPreviewUrl={step.id === "build" ? buildPreviewUrl : undefined}
        />
      ))}
    </div>
  );
}

type StepCardProps = {
  label: string;
  buildPreviewUrl?: string;
};

function StepCard({ label, buildPreviewUrl }: StepCardProps) {
  if (buildPreviewUrl) {
    return (
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-2">
          <span className="text-xs font-semibold tracking-wider text-gray-500">
            {label}
          </span>
        </div>
        <iframe
          src={buildPreviewUrl}
          title="Preview"
          className="h-[480px] w-full border-0"
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-100 px-6 py-5">
      <span className="text-xs font-semibold tracking-wider text-gray-500">
        {label}
      </span>
    </div>
  );
}
