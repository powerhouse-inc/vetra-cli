import { useState, type ReactNode } from "react";
import type { StoryLayer } from "../story/storyLayers.js";
import { DockSplit } from "./DockSplit.js";
import type { Dock } from "./layoutPrefs.js";

/** The story's layer as Review shows it; Review owns it (Outcome first). */
export type ReviewStory = {
  layer: StoryLayer;
  onLayerChange: (layer: StoryLayer) => void;
};

export type ReviewLayoutProps = {
  /** The live view once live with no change open, else the preview. */
  product: ReactNode;
  /** The story with its steer box; a function gets Review's layer. A plain
   *  node (no story yet) shows as it is, without the layer toggle. */
  side: ReactNode | ((story: ReviewStory) => ReactNode);
  dock: Dock;
  size: number;
  onResize: (size: number) => void;
  /** An optional panel on the right of the product (Theme, Task 4.3). */
  panel?: ReactNode;
};

/**
 * Review mode (spec G2): the product in the middle at full height, the chat
 * docked beside or under it, its story collapsed to the Outcome layer with
 * "Show activity".
 */
export function ReviewLayout({
  product,
  side,
  dock,
  size,
  onResize,
  panel,
}: ReviewLayoutProps) {
  const [layer, setLayer] = useState<StoryLayer>("outcome");
  const story =
    typeof side === "function" ? (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 justify-end border-b border-border px-4 py-1.5">
          <button
            type="button"
            aria-pressed={layer !== "outcome"}
            onClick={() =>
              setLayer((current) =>
                current === "outcome" ? "activity" : "outcome",
              )
            }
            className={
              "rounded-full border px-2.5 py-0.5 text-xs font-medium " +
              (layer !== "outcome"
                ? "border-vetra-primary/50 bg-vetra-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent")
            }
          >
            Show activity
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {side({ layer, onLayerChange: setLayer })}
        </div>
      </div>
    ) : (
      side
    );
  return (
    <DockSplit
      dock={dock}
      size={size}
      onResize={onResize}
      sideLabel="Story"
      side={story}
      main={
        <div data-review-product className="flex h-full min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{product}</div>
          {panel ? (
            <div
              data-review-panel
              className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card"
            >
              {panel}
            </div>
          ) : null}
        </div>
      }
    />
  );
}
