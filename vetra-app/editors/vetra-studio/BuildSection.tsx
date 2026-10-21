import { useTheme } from "@powerhousedao/reactor-browser";
import { useMemo, useRef, useState, type Ref } from "react";
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
    <div data-tour="build-preview" className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-8 py-2">
        <Breadcrumb items={crumbs} />
        <PreviewStatusChip preview={preview} />
      </div>
      <PreviewBody preview={preview} />
    </div>
  );
}

/** Skeleton copy before anything renders (spec §5.4): never a blank frame. */
export const SETTING_UP = "Setting up your project (about 30 s)…";
export const STARTING = "Starting the preview…";
export const UNREACHABLE = "The preview can't be reached right now.";

/** What the skeleton says for a preview that isn't showing yet. */
export function previewActivity(preview: ResolvedPreview): string {
  switch (preview.kind) {
    case "no-target":
    case "loading":
    case "unknown-project":
      return SETTING_UP;
    case "project-stopped":
    case "starting":
    case "ready":
      return STARTING;
    case "error":
      return UNREACHABLE;
  }
}

/**
 * The preview body: the iframe once the preview is up, else a skeleton with
 * the current activity. While the same project restarts, the last frame
 * stays mounted under the skeleton so its scroll position survives; a hot
 * reload inside the frame keeps it too.
 */
export function PreviewBody({
  preview,
  reloadKey = 0,
  activity,
  note,
  frameRef,
}: {
  preview: ResolvedPreview;
  /** Bumped to reload the frame (Restart preview). */
  reloadKey?: number;
  /** Replaces the skeleton copy (e.g. "Kitchen queue — building…"). */
  activity?: string;
  /** A small line over a showing preview (e.g. "Kitchen queue — building…"). */
  note?: string;
  /** The frame element, for snapshots of the build. */
  frameRef?: Ref<HTMLIFrameElement>;
}) {
  const { theme } = useTheme();
  const url = preview.kind === "ready" ? preview.url : undefined;

  /* Carry the Studio theme into the preview so its boot script can theme the
   * first paint. Keyed on src: toggling re-mounts the iframe with the new
   * param (live sync without reload lands with upstream storage-event sync). */
  const src = useMemo(() => {
    if (!url) return undefined;
    const u = new URL(url, window.location.origin);
    u.searchParams.set("theme", theme);
    return u.toString();
  }, [url, theme]);

  // The last frame shown, kept while its project restarts.
  const last = useRef<{ project: string; src: string } | null>(null);
  if (src && preview.kind === "ready") {
    last.current = { project: preview.project, src };
  } else if (!(
    (preview.kind === "starting" || preview.kind === "project-stopped") &&
    last.current?.project === preview.project
  )) {
    last.current = null;
  }
  const frameSrc = src ?? last.current?.src;
  const frameKey = `${frameSrc ?? ""}#${reloadKey}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const showing = src !== undefined && loadedKey === frameKey;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {frameSrc ? (
        <iframe
          key={frameKey}
          ref={frameRef}
          src={frameSrc}
          title="Preview"
          onLoad={() => setLoadedKey(frameKey)}
          className="block min-h-0 w-full flex-1 border-0"
        />
      ) : null}
      {showing ? null : (
        <PreviewSkeleton
          text={activity ?? previewActivity(preview)}
          overlay={frameSrc !== undefined}
        />
      )}
      {showing && note ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          {note}
        </div>
      ) : null}
    </div>
  );
}

/** Placeholder shapes of a screen with the current activity in words. */
function PreviewSkeleton({
  text,
  overlay,
}: {
  text: string;
  overlay: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-preview-skeleton
      className={`flex min-h-0 flex-1 flex-col gap-4 bg-accent px-8 py-8 ${overlay ? "absolute inset-0" : ""}`}
    >
      <div aria-hidden className="flex animate-pulse flex-col gap-3">
        <div className="h-5 w-1/3 rounded bg-border" />
        <div className="h-3 w-2/3 rounded bg-border/70" />
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div className="h-24 rounded-lg bg-border/60" />
          <div className="h-24 rounded-lg bg-border/60" />
          <div className="h-24 rounded-lg bg-border/60" />
        </div>
        <div className="h-3 w-1/2 rounded bg-border/70" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{text}</p>
    </div>
  );
}
