import { useCallback, useState } from "react";
import {
  effectiveDock,
  effectiveMode,
  readLayout,
  writeLayout,
  type Dock,
  type LayoutMode,
  type LayoutPrefs,
} from "./layoutPrefs.js";

const SIZE_MIN = 20;
const SIZE_MAX = 70;

export type Layout = {
  mode: LayoutMode;
  dock: Dock;
  size: number;
  setMode: (mode: LayoutMode) => void;
  setDock: (dock: Dock) => void;
  setSize: (size: number) => void;
};

/**
 * The page layout (spec G2), remembered per Studio in this browser: Build
 * while building and Review once live until the customer picks a mode; the
 * chat docks left in Build and right in Review until they pick a side.
 */
export function useLayout(studioId: string, live: boolean): Layout {
  const [prefs, setPrefs] = useState(() => readLayout(studioId));
  const update = useCallback(
    (patch: Partial<LayoutPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        writeLayout(studioId, next);
        return next;
      });
    },
    [studioId],
  );
  const setMode = useCallback((mode: LayoutMode) => update({ mode }), [update]);
  const setDock = useCallback(
    (dock: Dock) => update({ dock, dockSet: true }),
    [update],
  );
  const setSize = useCallback(
    (size: number) =>
      update({ size: Math.min(SIZE_MAX, Math.max(SIZE_MIN, size)) }),
    [update],
  );
  const mode = effectiveMode(prefs, { live });
  return {
    mode,
    dock: effectiveDock(prefs, mode),
    size: prefs.size,
    setMode,
    setDock,
    setSize,
  };
}
