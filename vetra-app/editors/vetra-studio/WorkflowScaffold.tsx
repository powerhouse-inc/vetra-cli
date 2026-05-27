import { PreviewStatusChip } from "./PreviewStatusChip.js";
import type { ResolvedPreview } from "./hooks/useResolvedPreview.js";

type StepId = "ideate" | "specify" | "build" | "deploy";

const STEPS: { id: StepId; label: string }[] = [
  { id: "ideate", label: "IDEATE" },
  { id: "specify", label: "SPECIFY" },
  { id: "build", label: "BUILD" },
  { id: "deploy", label: "DEPLOY" },
];

export type WorkflowScaffoldProps = {
  selectedSessionId: string | undefined;
  /** Live preview resolution from the preview-server. The component renders
   *  the iframe when `ready`, a status message otherwise. */
  preview: ResolvedPreview;
};

export function WorkflowScaffold({
  selectedSessionId,
  preview,
}: WorkflowScaffoldProps) {
  if (!selectedSessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Start a session to see the workflow.
      </div>
    );
  }

  /* `no-target` is the only state where we fall back to the IDEATE-stage
   * placeholder cards — the agent hasn't called `spec-preview-show` yet, so
   * there's nothing to show. Every other state belongs in the BUILD pane
   * (either the live iframe, or a transient status while it warms up). */
  if (preview.kind === "no-target") {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-8 py-12">
        {STEPS.map((step) => (
          <StepCard key={step.id} label={step.label} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-2">
        <ProgressBar currentStep="build" />
        <PreviewStatusChip preview={preview} />
      </div>
      <PreviewBody preview={preview} />
    </div>
  );
}

function PreviewBody({ preview }: { preview: ResolvedPreview }) {
  if (preview.kind === "ready") {
    return (
      <iframe
        src={preview.url}
        title="Preview"
        className="block min-h-0 w-full flex-1 border-0"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 px-6 py-10">
      <PreviewStatus preview={preview} />
    </div>
  );
}

function PreviewStatus({ preview }: { preview: ResolvedPreview }) {
  switch (preview.kind) {
    case "loading":
      return <StatusBlock title="Loading preview…" />;
    case "starting":
      return (
        <StatusBlock
          title={`Starting "${preview.project}"…`}
          detail="Reactor project is booting. This usually takes 10–30 seconds."
        />
      );
    case "project-stopped":
      return (
        <StatusBlock
          title={`Starting "${preview.project}"…`}
          detail="Bringing the reactor project online."
        />
      );
    case "unknown-project":
      return (
        <StatusBlock
          title={`Project "${preview.project}" not found`}
          detail={preview.error}
          tone="error"
        />
      );
    case "error":
      return (
        <StatusBlock
          title="Could not reach preview server"
          detail={preview.message}
          tone="error"
        />
      );
    default:
      return null;
  }
}

function StatusBlock({
  title,
  detail,
  tone,
}: {
  title: string;
  detail?: string;
  tone?: "error";
}) {
  return (
    <div className="max-w-md text-center">
      <div
        className={
          "text-sm font-medium " +
          (tone === "error" ? "text-red-700" : "text-gray-800")
        }
      >
        {title}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-gray-500">{detail}</div>
      ) : null}
    </div>
  );
}

function ProgressBar({ currentStep }: { currentStep: StepId }) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);
  return (
    <ol className="flex min-w-0 items-center gap-2">
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
