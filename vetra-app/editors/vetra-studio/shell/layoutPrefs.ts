export type LayoutMode = "build" | "review" | "demo";
export type Dock = "left" | "right" | "bottom";
export type LayoutPrefs = {
  mode: LayoutMode | null;
  dock: Dock;
  /** Chat/story pane share in %, 20-70. */
  size: number;
  /** True once the customer picked a dock; otherwise the mode default applies. */
  dockSet: boolean;
};

export const LAYOUT_KEY = (studioId: string): string =>
  `vetra-studio:layout:${studioId}`;
const LEGACY_WIDTH_KEY = "vetra-studio:story-width";
const SIZE_MIN = 20;
const SIZE_MAX = 70;
const SIZE_DEFAULT = 38;

const MODES: readonly string[] = ["build", "review", "demo"];
const DOCKS: readonly string[] = ["left", "right", "bottom"];

function clampSize(n: number): number {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function legacySize(): number {
  const raw = safeGet(LEGACY_WIDTH_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? clampSize(parsed) : SIZE_DEFAULT;
}

export function readLayout(studioId: string): LayoutPrefs {
  const defaults: LayoutPrefs = {
    mode: null,
    dock: "left",
    size: legacySize(),
    dockSet: false,
  };
  const raw = safeGet(LAYOUT_KEY(studioId));
  if (raw === null) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof parsed !== "object" || parsed === null) return defaults;
  const p = parsed as Record<string, unknown>;
  const dockValid = typeof p.dock === "string" && DOCKS.includes(p.dock);
  return {
    mode:
      typeof p.mode === "string" && MODES.includes(p.mode)
        ? (p.mode as LayoutMode)
        : null,
    dock: dockValid ? (p.dock as Dock) : "left",
    size:
      typeof p.size === "number" && Number.isFinite(p.size)
        ? clampSize(p.size)
        : defaults.size,
    dockSet: dockValid && p.dockSet === true,
  };
}

export function writeLayout(studioId: string, prefs: LayoutPrefs): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY(studioId), JSON.stringify(prefs));
  } catch {
    // Blocked storage: preferences last for this visit only.
  }
}

export function effectiveMode(
  prefs: LayoutPrefs,
  { live }: { live: boolean },
): LayoutMode {
  return prefs.mode ?? (live ? "review" : "build");
}

export function effectiveDock(prefs: LayoutPrefs, mode: LayoutMode): Dock {
  if (prefs.dockSet) return prefs.dock;
  return mode === "build" ? "left" : "right";
}
