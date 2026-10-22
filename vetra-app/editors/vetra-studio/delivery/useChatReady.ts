/**
 * Reactive chat-runtime readiness for the UI: false while the Studio's daemon
 * is unreachable, true once it answers (one-way — a later restart is caught
 * per send by `waitForChatReady`). The idea screen exposes it as
 * `data-chat-ready`, so the staging harness waits on the same real signal
 * instead of racing the first prompt.
 */
import { useEffect, useState } from "react";
import {
  CHAT_READY_POLL_MS,
  probeChatRuntime,
  type ChatReadyProbe,
} from "./chatReadiness.js";

export type UseChatReadyOptions = {
  probe?: ChatReadyProbe;
  pollMs?: number;
};

export function useChatReady({
  probe = probeChatRuntime,
  pollMs = CHAT_READY_POLL_MS,
}: UseChatReadyOptions = {}): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    let live = true;
    let timer: NodeJS.Timeout | undefined;
    const poll = async () => {
      let ok = false;
      try {
        ok = await probe();
      } catch {
        // Unreachable: poll again.
      }
      if (!live) return;
      if (ok) {
        setReady(true);
        return;
      }
      timer = setTimeout(() => void poll(), pollMs);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [probe, pollMs, ready]);

  return ready;
}
