/**
 * Whether the chat runtime can take a message right now.
 *
 * The chat-session watcher runs inside the Studio's vetra daemon (the same
 * process as the preview server). A cloud Studio's pod can restart (a model
 * key change, an upgrade) while the browser keeps the Studio open; a message
 * dispatched in that window is written into the local document but the
 * restarted daemon never picks it up, so it is lost. Waiting for the daemon
 * to answer `/healthz` is a real readiness signal — unlike a fixed sleep, it
 * ends as soon as the process is back.
 *
 * A Studio without `studio.config.json` (vite dev, or an older Studio) has no
 * daemon to ask: readiness is unknown, and callers must not block on it.
 */
import {
  fetchHealthz,
  resolvePreviewServerConfigured,
} from "../hooks/preview-server-client.js";

/** How often the probe is repeated while the daemon is down. */
export const CHAT_READY_POLL_MS = 1_000;
/** How long a send waits for the daemon before it gives up. */
export const CHAT_READY_BUDGET_MS = 180_000;

export type ChatReadyProbe = () => Promise<boolean>;

/** The real probe: the daemon's `/healthz`. Unknown (no config) counts ready. */
export const probeChatRuntime: ChatReadyProbe = async () => {
  try {
    if (!(await resolvePreviewServerConfigured())) return true;
    return await fetchHealthz();
  } catch {
    return false;
  }
};

export type WaitForChatReadyOptions = {
  probe?: ChatReadyProbe;
  budgetMs?: number;
  pollMs?: number;
  /** Fake clock/timer seams for tests. */
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Polls the real readiness probe until it answers (or the budget runs out).
 * The first probe is immediate, so a ready runtime costs no delay.
 */
export async function waitForChatReady(
  options: WaitForChatReadyOptions = {},
): Promise<boolean> {
  const {
    probe = probeChatRuntime,
    budgetMs = CHAT_READY_BUDGET_MS,
    pollMs = CHAT_READY_POLL_MS,
    now = Date.now,
    wait = sleep,
    signal,
  } = options;
  const deadline = now() + budgetMs;
  for (;;) {
    if (signal?.aborted) return false;
    try {
      if (await probe()) return true;
    } catch {
      // Unreachable counts as not ready; the next poll asks again.
    }
    if (signal?.aborted) return false;
    const left = deadline - now();
    if (left <= 0) return false;
    await wait(Math.min(pollMs, left));
  }
}
