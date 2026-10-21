import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Dock } from "./layoutPrefs.js";

const SIZE_MIN = 20;
const SIZE_MAX = 70;
const SIZE_DEFAULT = 38;
const KEY_STEP = 2;
const BOTTOM_MIN_PX = 240;

function clamp(value: number): number {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, value));
}

export type DockSplitProps = {
  dock: Dock;
  /** The side pane's share in %, 20-70. */
  size: number;
  /** Reported once per drag end, and on each keyboard step or reset. */
  onResize: (size: number) => void;
  side: ReactNode;
  main: ReactNode;
  sideLabel: string;
};

/** The story/chat pane docked left, right or bottom, with a resizable split. */
export function DockSplit({
  dock,
  size,
  onResize,
  side,
  main,
  sideLabel,
}: DockSplitProps) {
  const [live, setLive] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Removes a drag's window listeners (on mouse up or unmount). */
  const endDrag = useRef<(() => void) | null>(null);
  const vertical = dock !== "bottom";
  const shown = live ?? size;

  useEffect(() => () => endDrag.current?.(), []);

  function onMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    endDrag.current?.();
    setDragging(true);
    let latest: number | null = null;
    function onMove(e: MouseEvent) {
      if (!rect) return;
      let percent: number;
      if (dock === "left") {
        percent = ((e.clientX - rect.left) / rect.width) * 100;
      } else if (dock === "right") {
        percent = ((rect.right - e.clientX) / rect.width) * 100;
      } else {
        percent = ((rect.bottom - e.clientY) / rect.height) * 100;
      }
      latest = clamp(percent);
      setLive(latest);
    }
    function detach() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      endDrag.current = null;
    }
    function onUp() {
      detach();
      setDragging(false);
      setLive(null);
      if (latest !== null) onResize(latest);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    endDrag.current = detach;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Arrow toward the side pane's far edge grows it; the other way shrinks it.
    const grow =
      dock === "left"
        ? "ArrowRight"
        : dock === "right"
          ? "ArrowLeft"
          : "ArrowUp";
    const shrink =
      dock === "left"
        ? "ArrowLeft"
        : dock === "right"
          ? "ArrowRight"
          : "ArrowDown";
    if (event.key === grow) {
      event.preventDefault();
      onResize(clamp(size + KEY_STEP));
    } else if (event.key === shrink) {
      event.preventDefault();
      onResize(clamp(size - KEY_STEP));
    }
  }

  const sidePane = (
    <aside
      key="side"
      aria-label={sideLabel}
      className="flex shrink-0 flex-col overflow-hidden bg-card"
      // R11: at the bottom the pane keeps a floor, so the steer box and a
      // question never clip on a short window.
      style={
        vertical
          ? { width: `${shown}%` }
          : { height: `${shown}%`, minHeight: BOTTOM_MIN_PX }
      }
    >
      {side}
    </aside>
  );
  const separator = (
    <div
      key="sep"
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label="Resize"
      aria-valuemin={SIZE_MIN}
      aria-valuemax={SIZE_MAX}
      aria-valuenow={Math.round(shown)}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(SIZE_DEFAULT)}
      className={
        vertical
          ? "w-1.5 shrink-0 cursor-col-resize border-x border-border bg-card hover:bg-accent"
          : "h-1.5 shrink-0 cursor-row-resize border-y border-border bg-card hover:bg-accent"
      }
    />
  );
  const mainPane = (
    <main
      key="main"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {main}
    </main>
  );

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 flex-1 overflow-hidden ${vertical ? "flex-row" : "flex-col"}`}
    >
      {dock === "left"
        ? [sidePane, separator, mainPane]
        : [mainPane, separator, sidePane]}
      {dragging ? (
        /* Keeps the preview iframe from swallowing the drag. */
        <div
          aria-hidden
          className={`fixed inset-0 z-50 ${vertical ? "cursor-col-resize" : "cursor-row-resize"}`}
        />
      ) : null}
    </div>
  );
}
