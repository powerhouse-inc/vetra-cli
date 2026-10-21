/**
 * Whether a live app can be shown in a frame (spec §5.6, D12). A frame that
 * hasn't loaded after 10 s, or that the browser refused (X-Frame-Options /
 * CSP `frame-ancestors` — the frame stays on `about:blank`), switches the
 * product view to the Studio preview of the live version.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const EMBED_TIMEOUT_MS = 10_000;

export type EmbedFallback = {
  /** The live app can't be framed: show the preview instead. */
  failed: boolean;
  /** The frame's load event: a real page (or a refusal, see above). */
  onLoad: (frame: HTMLIFrameElement) => void;
  /** The frame reported an error. */
  onError: () => void;
};

export function useEmbedFallback(
  src: string | null,
  timeoutMs: number = EMBED_TIMEOUT_MS,
): EmbedFallback {
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    setFailed(false);
    if (!src) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setFailed(true);
    }, timeoutMs);
    return stopTimer;
  }, [src, timeoutMs, stopTimer]);

  const onLoad = useCallback(
    (frame: HTMLIFrameElement) => {
      stopTimer();
      try {
        // A refused frame never navigates, so it is still on about:blank.
        // Another origin throws on access: the live app itself is there.
        if (frame.contentWindow?.location.href === "about:blank") {
          setFailed(true);
        }
      } catch {
        // Cross-origin frame: it loaded the live app.
      }
    },
    [stopTimer],
  );

  const onError = useCallback(() => {
    stopTimer();
    setFailed(true);
  }, [stopTimer]);

  return { failed, onLoad, onError };
}
