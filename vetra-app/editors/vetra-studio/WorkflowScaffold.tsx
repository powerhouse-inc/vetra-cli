type Step = {
  id: "ideate" | "specify" | "build" | "deploy";
  label: string;
};

const STEPS: Step[] = [
  { id: "ideate", label: "IDEATE" },
  { id: "specify", label: "SPECIFY" },
  { id: "build", label: "BUILD" },
  { id: "deploy", label: "DEPLOY" },
];

export type WorkflowScaffoldProps = {
  selectedSessionId: string | undefined;
};

export function WorkflowScaffold({ selectedSessionId }: WorkflowScaffoldProps) {
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
        <div
          key={step.id}
          className="rounded-lg border border-gray-200 bg-gray-100 px-6 py-5"
        >
          <span className="text-xs font-semibold tracking-wider text-gray-500">
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
