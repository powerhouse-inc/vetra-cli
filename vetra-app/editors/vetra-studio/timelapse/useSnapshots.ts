/**
 * Takes a picture of the preview now and then while a change is building
 * (for the time-lapse). Runs in the driver's browser from the same-origin
 * preview frame; a cross-origin frame, a failed capture or a failed upload
 * is skipped silently. Never throws, never blocks the page.
 */
import type { Change } from "document-models/studio-product";
import { useEffect, useRef, type RefObject } from "react";
import { uploadSnapshot } from "../hooks/workshop-client.js";
import {
  frameHash,
  SNAPSHOT_QUALITY,
  SNAPSHOT_WIDTH,
  shouldSnapshot,
} from "./snapshots.js";

const POLL_MS = 5_000;

type State = { lastAt: number | null; lastHash: string | null; count: number };

function idle(run: () => void): void {
  const ric = (
    globalThis as { requestIdleCallback?: (cb: () => void) => number }
  ).requestIdleCallback;
  if (ric) ric(run);
  else setTimeout(run, 0);
}

export function captureFrame(
  frame: HTMLIFrameElement | null,
): { hash: string; take: () => Promise<Blob | null> } | null {
  let body: HTMLElement | null | undefined;
  try {
    body = frame?.contentDocument?.body;
  } catch {
    return null;
  }
  if (!body) return null;
  const el = body;
  return {
    hash: frameHash(el),
    take: async () => {
      const { toJpeg } = await import("html-to-image");
      const width = el.scrollWidth || el.clientWidth || SNAPSHOT_WIDTH;
      const height = el.scrollHeight || el.clientHeight || 1;
      const scale = Math.min(1, SNAPSHOT_WIDTH / width);
      const url = await toJpeg(el, {
        quality: SNAPSHOT_QUALITY,
        canvasWidth: Math.round(width * scale),
        canvasHeight: Math.round(height * scale),
        pixelRatio: 1,
      });
      return await (await fetch(url)).blob();
    },
  };
}

export function useSnapshots(
  frameRef: RefObject<HTMLIFrameElement | null>,
  change: Change | null,
): void {
  const state = useRef<State>({ lastAt: null, lastHash: null, count: 0 });
  const changeId = change?.id ?? null;
  const building = change?.status === "BUILDING";

  useEffect(() => {
    state.current = { lastAt: null, lastHash: null, count: 0 };
  }, [changeId]);

  useEffect(() => {
    if (!changeId || !building) return;
    let busy = false;
    let stopped = false;
    const tick = () => {
      if (busy || stopped) return;
      busy = true;
      idle(() => {
        void (async () => {
          try {
            const cap = captureFrame(frameRef.current);
            if (!cap || stopped) return;
            const now = Date.now();
            if (
              !shouldSnapshot({
                ...state.current,
                now,
                hash: cap.hash,
                building: true,
              })
            )
              return;
            const blob = await cap.take();
            if (!blob || stopped) return;
            await uploadSnapshot(changeId, new Date(now).toISOString(), blob);
            state.current = {
              lastAt: now,
              lastHash: cap.hash,
              count: state.current.count + 1,
            };
          } catch {
            // A failed capture is ignored; the next tick tries again.
          } finally {
            busy = false;
          }
        })();
      });
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [changeId, building, frameRef]);
}
