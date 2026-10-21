/**
 * Team document trigger: makes sure the Studio has its team document, once.
 * A cloud Studio with nobody signed in yet gets `pending` back, so the next
 * poll tries again; once the document is initialised the trigger goes quiet.
 * Runs detached, never boots a reactor on a one-shot run.
 */
import { defineTrigger } from "../framework.js";
import { ensureTeamDoc, type TeamContext } from "../team/team-doc.js";

/** How often a pending team document is tried again. */
export const TEAM_DOC_RETRY_MS = 15_000;

interface TeamDocState {
  done: boolean;
  running: boolean;
  lastTryAt: number;
}

export const teamDocTrigger = defineTrigger<TeamDocState>({
  id: "team-doc",
  type: "condition",
  state: () => ({ done: false, running: false, lastTryAt: 0 }),

  async poll(tctx) {
    const state = tctx.state;
    const ctx = tctx.commandContext as unknown as TeamContext;
    if (state.done || state.running || !ctx.folders) return null;
    const nowMs = Date.now();
    if (nowMs - state.lastTryAt < TEAM_DOC_RETRY_MS) return null;
    state.lastTryAt = nowMs;
    state.running = true;
    void ensureTeamDoc(ctx)
      .then((r) => {
        state.done = !r.pending;
      })
      .catch((err: unknown) =>
        ctx.log?.warn?.(`[team-doc] not ready yet (tried again later): ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => {
        state.running = false;
      });
    return null;
  },
});
