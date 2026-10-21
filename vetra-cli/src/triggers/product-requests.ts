/**
 * Product requests trigger: the agent's side of everything the Studio page
 * asks for by writing the product document, plus the automatic first launch.
 *
 * Every few seconds, one pass:
 * 1. on the first pass after a start, any LAUNCHING version is resumed (F22);
 * 2. a waiting request is served — LAUNCH (Make it live / Try again),
 *    ROLLBACK (Go back, after the data check), RESTART, DISCARD, MIRROR (GitHub arrives in M4);
 * 3. otherwise, while nothing is live, a READY change that was never launched
 *    goes live by itself (D3, F6, F10).
 * The access switch (F35) runs in its own lane, so it never waits behind a
 * launch.
 *
 * Passes run detached from the shared trigger loop (a launch takes minutes)
 * and never overlap. Nothing here needs a browser or the LLM. Only a Studio
 * (an environment id is configured) launches.
 */
import type { ProductAccess } from "vetra-app/document-models/studio-product";
import { defineTrigger } from "../framework.js";
import {
  AUTO_LAUNCHED_BY,
  LAUNCH_REASONS,
  LAUNCH_TRIGGER,
  autoLaunchCandidate,
  discardChange,
  launch,
  recordRequestFailure,
  restartLive,
  resumeLaunch,
  syncAccess,
  type OrchestratorContext,
} from "../launch/orchestrator.js";
import { REASONS } from "../launch/cloud-launch.js";
import { goBack } from "../launch/rollback.js";
import { dispatchProduct, getProductDoc, productActions as a } from "../product/product-doc.js";

const TAG = "[product-requests]";
/** How often a pass starts (a request should be picked up within seconds). */
export const REQUESTS_INTERVAL_MS = 3_000;
/** How often the access lane compares the drive with the product's access setting. */
export const ACCESS_INTERVAL_MS = 10_000;
/** How long the access lane waits after a refused try. */
export const ACCESS_RETRY_MS = 60_000;

export interface RequestsMemory {
  /** Changes the automatic launch already tried in this process (F10 belt and braces). */
  autoTried: Set<string>;
}

export function newRequestsMemory(): RequestsMemory {
  return { autoTried: new Set<string>() };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One pass; returns what it did (for logs and tests). Never throws. */
export async function requestsPass(
  ctx: OrchestratorContext,
  memory: RequestsMemory,
): Promise<string | null> {
  try {
    const product = await getProductDoc(ctx);
    if (!product) return null;
    const state = product.state;

    // Any pass, not only the first after a start: a START_LAUNCH that applied
    // but whose dispatch then threw would otherwise wait for the next restart.
    // F7: while the owner's OK is missing or ran out, resuming would only hit
    // the same cloud refusal every pass (a 3-second retry storm). The page
    // records `SET_LAUNCH_PERMISSION GRANTED`; the next pass resumes.
    const launching = state.versions.filter((v) => v.status === "LAUNCHING");
    if (launching.length > 0) {
      if (
        state.launchPermission === "MISSING" ||
        state.launchPermission === "EXPIRED"
      ) {
        return "needs-permission";
      }
      for (const v of launching) await resumeLaunch(ctx, v.number);
      return "resume";
    }

    const request = state.pendingRequest;
    if (request) {
      switch (request.kind) {
        case "LAUNCH": {
          // Cleared with START_LAUNCH: the LAUNCHING version stands for it.
          const outcome = request.changeId
            ? await launch(ctx, {
                changeId: request.changeId,
                trigger: LAUNCH_TRIGGER,
                launchedBy: request.requestedBy,
                clearRequest: true,
              })
            : null;
          if (!outcome || outcome.status === "SKIPPED") {
            const why = outcome?.reason ?? "no change named";
            ctx.log?.warn?.(`${TAG} launch request not started: ${why}`);
            // Never leave it waiting: a stale request would launch again.
            await recordRequestFailure(ctx, "LAUNCH", LAUNCH_REASONS.notReady);
          }
          return "launch";
        }
        case "ROLLBACK":
          if (request.targetVersion === null || request.targetVersion === undefined) {
            await recordRequestFailure(ctx, "ROLLBACK", REASONS.rollbackStudioVersion);
            return "rollback-without-version";
          }
          // The data check first (D6), then the rollback (rollback.ts).
          await goBack(ctx, request.targetVersion);
          return "rollback";
        case "RESTART":
          await restartLive(ctx);
          return "restart";
        case "DISCARD":
          await discardChange(ctx, request.changeId ?? null);
          return "discard";
        case "MIRROR":
          ctx.log?.info?.(`${TAG} GitHub isn't connected in this Studio yet; nothing to save there`);
          await dispatchProduct(ctx, [a.clearRequest({})]);
          return "mirror";
      }
    }

    const candidate = autoLaunchCandidate(state);
    if (candidate && !memory.autoTried.has(candidate.id)) {
      memory.autoTried.add(candidate.id);
      await launch(ctx, { changeId: candidate.id, trigger: LAUNCH_TRIGGER, launchedBy: AUTO_LAUNCHED_BY });
      return "auto-launch";
    }
    return null;
  } catch (err) {
    ctx.log?.error?.(`${TAG} pass failed: ${message(err)}`);
    return null;
  }
}

interface RequestsState extends Record<string, unknown> {
  lastPassAt: number;
  running: boolean;
  memory: RequestsMemory;
  accessRunning: boolean;
  accessNextAt: number;
  accessApplied: Map<string, ProductAccess>;
}

export const productRequestsTrigger = defineTrigger<RequestsState>({
  id: "product-requests",
  type: "condition",
  state: () => ({
    lastPassAt: 0,
    running: false,
    memory: newRequestsMemory(),
    accessRunning: false,
    accessNextAt: 0,
    accessApplied: new Map<string, ProductAccess>(),
  }),

  // Returns at once: the work runs detached so the shared loop (chat
  // included) never waits on a launch.
  async poll(tctx) {
    const state = tctx.state;
    const ctx = tctx.commandContext as unknown as OrchestratorContext;
    // Reads only on a one-shot run (no reactor booted), and only a Studio launches.
    if (!ctx.folders || !ctx.config?.environmentId) return null;
    const log = ctx.log;
    const nowMs = Date.now();

    if (!state.running && nowMs - state.lastPassAt >= REQUESTS_INTERVAL_MS) {
      state.lastPassAt = nowMs;
      state.running = true;
      void requestsPass(ctx, state.memory)
        .then((did) => {
          if (did) log?.debug?.(`${TAG} ${did}`);
        })
        .finally(() => {
          state.running = false;
        });
    }

    if (!state.accessRunning && nowMs >= state.accessNextAt) {
      state.accessRunning = true;
      state.accessNextAt = nowMs + ACCESS_INTERVAL_MS;
      void syncAccess(ctx, state.accessApplied)
        .then((result) => {
          if (result === "failed") state.accessNextAt = Date.now() + ACCESS_RETRY_MS;
        })
        .catch((err: unknown) => log?.warn?.(`${TAG} access check failed: ${message(err)}`))
        .finally(() => {
          state.accessRunning = false;
        });
    }
    return null;
  },
});
