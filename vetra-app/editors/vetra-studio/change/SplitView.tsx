/**
 * The Live | Preview split while a change is open on a live product (spec
 * §5.7, G6): the live app on the left, small and unchanged; the change's
 * preview on the right, large, with the Ready bar over it once the change's
 * checks pass.
 */
import type { ReactNode } from "react";
import { LIVE_LABEL, PREVIEW_LABEL } from "./changeCopy.js";

function PaneLabel({ children }: { children: string }) {
  return (
    <div className="shrink-0 border-b border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  );
}

export function SplitView({
  live,
  preview,
  bar,
}: {
  /** The live app as its users see it now. */
  live: ReactNode;
  /** The change's preview. */
  preview: ReactNode;
  /** The Ready bar (or the launch lines), shown over the preview. */
  bar?: ReactNode;
}) {
  return (
    <div data-split className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <section
        aria-label="Live"
        data-pane="live"
        className="flex w-[34%] min-w-0 shrink-0 flex-col border-r border-border"
      >
        <PaneLabel>{LIVE_LABEL}</PaneLabel>
        <div className="flex min-h-0 flex-1 flex-col">{live}</div>
      </section>
      <section
        aria-label="Preview"
        data-pane="preview"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <PaneLabel>{PREVIEW_LABEL}</PaneLabel>
        {bar}
        <div className="flex min-h-0 flex-1 flex-col">{preview}</div>
      </section>
    </div>
  );
}
