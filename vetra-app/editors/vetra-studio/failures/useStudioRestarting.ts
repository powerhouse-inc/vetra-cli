/**
 * "Your Studio is restarting — back in a moment." (spec §5.9): the Studio's
 * daemon answered before and now doesn't (an upgrade or a restart after
 * running out of memory). Polls its `/version`; a Studio that never answered
 * (no daemon, e.g. vite dev) never counts as restarting.
 */
import { useEffect, useState } from "react";
import { fetchVersion } from "../hooks/preview-server-client.js";

const POLL_MS = 15_000;
const POLL_RESTARTING_MS = 5_000;
/** Misses in a row before the Studio counts as restarting. */
export const MISSES_BEFORE_RESTARTING = 2;

export type RestartWatch = {
  /** The daemon answered at least once. */
  seen: boolean;
  /** Unanswered polls since the last answer. */
  misses: number;
};

export const INITIAL_WATCH: RestartWatch = { seen: false, misses: 0 };

/** The watch after one poll (`ok`: the daemon answered). */
export function nextWatch(watch: RestartWatch, ok: boolean): RestartWatch {
  if (ok) return { seen: true, misses: 0 };
  return watch.seen ? { seen: true, misses: watch.misses + 1 } : watch;
}

export function isRestarting(watch: RestartWatch): boolean {
  return watch.seen && watch.misses >= MISSES_BEFORE_RESTARTING;
}

export function useStudioRestarting(): boolean {
  const [watch, setWatch] = useState(INITIAL_WATCH);
  const restarting = isRestarting(watch);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      let ok = false;
      try {
        await fetchVersion(controller.signal);
        ok = true;
      } catch {
        // Unreachable: counted as a miss.
      }
      if (!live) return;
      setWatch((w) => nextWatch(w, ok));
      timer = setTimeout(
        () => void poll(),
        restarting ? POLL_RESTARTING_MS : POLL_MS,
      );
    }
    timer = setTimeout(() => void poll(), restarting ? POLL_RESTARTING_MS : 0);
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [restarting]);

  return restarting;
}
