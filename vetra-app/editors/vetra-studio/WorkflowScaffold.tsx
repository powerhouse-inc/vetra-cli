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

  /* When the BUILD preview is active, the other steps don't have meaningful
   * content yet — hide them so the iframe gets the full pane. Drop padding
   * and the BUILD card's own border/header so nothing else competes for
   * vertical space. The placeholders come back as soon as the preview is
   * cleared, and full step UI lands once the workflow registry is wired. */
  if (hasPreview) {
    return (
      <div className="h-full w-full">
        <iframe
          src={buildPreviewUrl}
          title="Preview"
          className="block h-full w-full border-0"
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

function StepCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-100 px-6 py-5">
      <span className="text-xs font-semibold tracking-wider text-gray-500">
        {label}
      </span>
    </div>
  );
}
