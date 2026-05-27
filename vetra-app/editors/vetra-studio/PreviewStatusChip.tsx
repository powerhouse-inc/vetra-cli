/**
 * Small status chip that surfaces the chat session's bound reactor project
 * and its current lifecycle state. Rendered in the chat header so the user
 * sees the project context even during IDEATE, before the BUILD iframe
 * takes the right pane.
 *
 * No interaction in this version — it's a passive readout. Could later
 * become a button that scrolls/focuses the BUILD pane.
 */
import type { ResolvedPreview } from "./hooks/useResolvedPreview.js";

export function PreviewStatusChip({ preview }: { preview: ResolvedPreview }) {
  /* no-target = session hasn't bound a project yet; render nothing rather
   * than a "no project" chip so the header stays clean during IDEATE. */
  if (preview.kind === "no-target") return null;

  const { label, tone, project } = describe(preview);

  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
        toneClasses(tone)
      }
      title={tooltipFor(preview)}
    >
      <span
        aria-hidden
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          dotClasses(tone) +
          (tone === "starting" ? " animate-pulse" : "")
        }
      />
      <span className="truncate max-w-[10rem]" title={project}>
        {project}
      </span>
      <span className="text-gray-500">·</span>
      <span>{label}</span>
    </span>
  );
}

type Tone = "ready" | "starting" | "stopped" | "error";

function describe(preview: Exclude<ResolvedPreview, { kind: "no-target" }>): {
  label: string;
  tone: Tone;
  project: string;
} {
  switch (preview.kind) {
    case "ready":
      return { label: "running", tone: "ready", project: preview.project };
    case "starting":
      return { label: "starting…", tone: "starting", project: preview.project };
    case "project-stopped":
      return { label: "starting…", tone: "starting", project: preview.project };
    case "loading":
      return { label: "checking…", tone: "starting", project: "" };
    case "unknown-project":
      return { label: "not found", tone: "error", project: preview.project };
    case "error":
      return { label: "unreachable", tone: "error", project: "preview-server" };
  }
}

function tooltipFor(preview: ResolvedPreview): string | undefined {
  switch (preview.kind) {
    case "ready":
      return preview.url;
    case "project-stopped":
      return "Project is not running — starting it.";
    case "starting":
      return "Reactor project is booting.";
    case "unknown-project":
      return preview.error;
    case "error":
      return preview.message;
    default:
      return undefined;
  }
}

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "error":
      return "border-red-200 bg-red-50 text-red-800";
    case "stopped":
      return "border-gray-200 bg-gray-50 text-gray-700";
  }
}

function dotClasses(tone: Tone): string {
  switch (tone) {
    case "ready":
      return "bg-emerald-500";
    case "starting":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    case "stopped":
      return "bg-gray-400";
  }
}
