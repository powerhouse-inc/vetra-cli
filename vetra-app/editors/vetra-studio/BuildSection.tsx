import { Breadcrumb, type Crumb } from "./Breadcrumb.js";
import { PreviewStatusChip } from "./PreviewStatusChip.js";
import type { ResolvedPreview } from "./hooks/useResolvedPreview.js";

/**
 * Home > Build. Hosts the live preview iframe for the project the agent last
 * surfaced via `spec-preview-show`, resolved reactively from the
 * preview-server. Falls back to a status readout while the project warms up
 * or when no preview target is bound yet.
 */
export function BuildSection({
  preview,
  productName,
  onExitToHome,
}: {
  preview: ResolvedPreview;
  productName: string;
  onExitToHome: () => void;
}) {
  const crumbs: Crumb[] = [
    { label: productName, onClick: onExitToHome },
    { label: "Build" },
  ];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-vetra-border bg-vetra-card px-8 py-2">
        <Breadcrumb items={crumbs} />
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
    <div className="flex min-h-0 flex-1 items-center justify-center bg-vetra-accent px-6 py-10">
      <PreviewStatus preview={preview} />
    </div>
  );
}

function PreviewStatus({ preview }: { preview: ResolvedPreview }) {
  switch (preview.kind) {
    case "no-target":
      return (
        <StatusBlock
          title="No preview yet"
          detail="The BUILD preview appears once the agent scaffolds a project for this session."
        />
      );
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
          (tone === "error" ? "text-vetra-destructive" : "text-vetra-fg")
        }
      >
        {title}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-vetra-muted-fg">{detail}</div>
      ) : null}
    </div>
  );
}
