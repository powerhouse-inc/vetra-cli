/** The story pane's layer switch: Outcome / Activity / Raw (spec §5.4). */
import type { StoryLayer } from "./storyLayers.js";

const LAYERS: readonly { value: StoryLayer; label: string }[] = [
  { value: "outcome", label: "Outcome" },
  { value: "activity", label: "Activity" },
  { value: "raw", label: "Raw" },
];

export function LayerSwitch({
  value,
  onChange,
}: {
  value: StoryLayer;
  onChange: (layer: StoryLayer) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Story detail"
      className="inline-flex rounded-full border border-border bg-muted p-0.5"
    >
      {LAYERS.map(({ value: layer, label }) => (
        <button
          key={layer}
          type="button"
          role="tab"
          aria-selected={layer === value}
          onClick={() => onChange(layer)}
          className={
            "rounded-full px-2.5 py-0.5 text-xs font-medium " +
            (layer === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
