import { useCallback, useEffect, useState, type RefObject } from "react";
import { attachPointLayer } from "./pointLayer.js";

export interface PointMode {
  active: boolean;
  toggle: () => void;
  /** The element last clicked (Tasks 3.2/3.5 read it for "Change this"). */
  selected: Element | null;
  /** The element last double-clicked for in-place text editing (Task 3.3). */
  editing: Element | null;
  clear: () => void;
}

/** Point mode over the preview frame: attached only while `active`. */
export function usePointMode(
  frameRef: RefObject<HTMLIFrameElement | null>,
  /** Re-attach key: bump when the frame element is replaced. */
  frameKey?: string,
): PointMode {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Element | null>(null);
  const [editing, setEditing] = useState<Element | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!active || !frame) return;
    return attachPointLayer(frame, {
      onSelect: setSelected,
      onEditText: setEditing,
      onExit: () => setActive(false),
    });
  }, [active, frameRef, frameKey]);

  const toggle = useCallback(() => setActive((a) => !a), []);
  const clear = useCallback(() => {
    setSelected(null);
    setEditing(null);
  }, []);
  return { active, toggle, selected, editing, clear };
}
