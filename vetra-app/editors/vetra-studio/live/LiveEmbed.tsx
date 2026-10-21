/**
 * The live product filling the page (spec §5.6, D12): the live address in a
 * frame — the production Connect opens the product drive, app view if it has
 * one. When the browser won't frame it (auth, X-Frame-Options, CSP) or it
 * doesn't load within 10 s, the Studio shows its own preview of the live
 * version, labelled exactly (Task 2.9).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { OPEN_IN_NEW_TAB, liveHost, previewLabel } from "./liveCopy.js";
import { useEmbedFallback } from "./useEmbedFallback.js";

export function LiveEmbed({
  liveUrl,
  version,
  preview,
}: {
  liveUrl: string;
  /** The live version's number, for the fallback's label. */
  version: number;
  /** The Studio's preview of that version (the build surface's pane). */
  preview: ReactNode;
}) {
  const { failed, onLoad, onError } = useEmbedFallback(liveUrl);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // React doesn't forward a frame's `error` event; listen to it directly.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.addEventListener("error", onError);
    return () => frame.removeEventListener("error", onError);
  }, [onError]);

  return (
    <div
      data-embed={failed ? "preview" : "live"}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-1.5">
        <span className="text-xs text-muted-foreground">
          {liveHost(liveUrl)}
        </span>
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs font-medium text-vetra-primary hover:underline"
        >
          {OPEN_IN_NEW_TAB}
        </a>
      </div>
      {failed ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border bg-card px-4 py-1.5">
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-vetra-primary hover:underline"
            >
              {previewLabel(version)}
            </a>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{preview}</div>
        </div>
      ) : (
        <iframe
          ref={frameRef}
          src={liveUrl}
          title="Your live product"
          onLoad={(e) => onLoad(e.currentTarget)}
          className="block min-h-0 w-full flex-1 border-0"
        />
      )}
    </div>
  );
}
