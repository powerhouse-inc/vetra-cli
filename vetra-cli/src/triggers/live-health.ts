/**
 * Live health trigger: the Studio's side of "what is actually live".
 *
 * Two jobs, one pass a minute while the Studio runs:
 *
 * - Health (spec §6.1 Live): with a live version and a live address, the
 *   address is checked with `checkLive`. Three failed checks in a row write
 *   `SET_HEALTH UNHEALTHY` once (logged at error); the next check that answers
 *   writes `HEALTHY` once. Nothing is written twice, and a failed check never
 *   stops the loop.
 * - Reconcile (spec §6.2: the cloud wins): once per process, when the product
 *   has a live version and no Version is LAUNCHING, the cloud's record for
 *   this Studio's product is read on the agent's own path (`studioProduct` +
 *   its latest deployment). A READY production deployment newer than the
 *   document's `liveVersion` means the launch finished while the Studio was
 *   down: `COMPLETE_LAUNCH` when the document still has the version as
 *   LAUNCHING/FAILED, `SET_LIVE_VERSION` when it is an earlier live version
 *   (older or newer than the document's), and the code follows it
 *   (`restoreVersion`, left as it is while the Studio has unsaved changes).
 *   A Go back whose deployment hadn't settled when the agent stopped waiting
 *   (`awaitRollbackSettle`) is reconciled on every pass until it settles: READY
 *   makes it live, FAILED puts the code back on the live version.
 *   Nothing is ever deleted or rewritten.
 * - Changes made on GitHub (F37): while a repository is linked, every pass
 *   copies the cloud's `App.externalChangesSha` (set by the push webhook)
 *   into the product with `SET_EXTERNAL_CHANGES` (mirror.ts).
 *
 * Slow tick: every 10 minutes the handlers registered with `onSlowTick` run
 * (one at a time, never overlapping) — e.g. working out ahead of time which
 * earlier versions the product's data can't go back to (F26).
 *
 * While a Version is LAUNCHING the product-requests trigger owns the launch
 * and resumes it (F22); this trigger skips the reconcile and tries the next
 * pass, so the two never race.
 */
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import { defineTrigger } from "../framework.js";
import { studioGql, type CloudContext } from "../launch/cloud-launch.js";
import type { OrchestratorContext } from "../launch/orchestrator.js";
import { restoreVersion } from "../launch/git-versions.js";
import { checkLive } from "../launch/verify.js";
import { syncExternalChanges } from "../launch/mirror.js";
import {
  dispatchProduct,
  getProductDoc,
  productActions as a,
} from "../product/product-doc.js";

const TAG = "[live-health]";
/** How often a pass starts (one check a minute, as the spec has it). */
export const HEALTH_INTERVAL_MS = 60_000;
/** Failed checks in a row that make the live app UNHEALTHY. */
export const HEALTH_FAILURES = 3;
/** How often the slow-tick handlers run. */
export const SLOW_TICK_MS = 10 * 60_000;

export type SlowTickHandler = (ctx: OrchestratorContext) => Promise<void>;

const slowTickHandlers = new Set<SlowTickHandler>();

/** Run `handler` every `SLOW_TICK_MS` while the Studio runs (first at start). */
export function onSlowTick(handler: SlowTickHandler): () => void {
  slowTickHandlers.add(handler);
  return () => {
    slowTickHandlers.delete(handler);
  };
}

/** One slow tick: every handler in turn; a failing one never stops the others. */
export async function slowTickPass(ctx: OrchestratorContext): Promise<void> {
  for (const handler of slowTickHandlers) {
    try {
      await handler(ctx);
    } catch (err) {
      ctx.log?.warn?.(`${TAG} slow tick failed: ${message(err)}`);
    }
  }
}

/** The deployment record the cloud keeps for the product (the fields used here). */
export interface CloudDeployment {
  id: string;
  status: string;
  kind: string;
  trigger: string | null;
  versionNumber: number | null;
  sha: string;
  gitRef: string;
  onBehalfOf: string | null;
  packages: { name: string; version: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface CloudStudioProduct {
  id: string;
  latestDeployment: CloudDeployment | null;
}

export interface LiveHealthDeps {
  now: () => Date;
  checkLive: typeof checkLive;
  /** Put the Studio's code on Version n (the orchestrator's seam by default). */
  restoreCode: (ctx: OrchestratorContext, n: number) => Promise<unknown>;
  /** The cloud's record for this Studio's product, on the agent's path. */
  readProduct: (
    ctx: CloudContext,
    studioEnvironmentId: string,
  ) => Promise<CloudStudioProduct | null>;
  /** F37: the cloud's changes made on GitHub into the product. */
  syncExternal: typeof syncExternalChanges;
}

const STUDIO_PRODUCT_QUERY = `query StudioLiveProduct($studioEnvironmentId: String!) {
  studioProduct(studioEnvironmentId: $studioEnvironmentId) {
    id
    latestDeployment {
      id
      status
      kind
      trigger
      versionNumber
      sha
      gitRef
      onBehalfOf
      createdAt
      updatedAt
      packages { name version }
    }
  }
}`;

/** The agent's authorised read of its own product's App (`studioProduct`). */
export async function readCloudProduct(
  ctx: CloudContext,
  studioEnvironmentId: string,
): Promise<CloudStudioProduct | null> {
  const data = await studioGql<{ studioProduct: CloudStudioProduct | null }>(
    ctx,
    "studioProduct",
    STUDIO_PRODUCT_QUERY,
    { studioEnvironmentId },
  );
  return data.studioProduct;
}

const defaultDeps: LiveHealthDeps = {
  now: () => new Date(),
  restoreCode: (ctx, n) => (ctx.deps?.restoreVersion ?? restoreVersion)(ctx.workdir, n),
  checkLive,
  readProduct: readCloudProduct,
  syncExternal: syncExternalChanges,
};

export interface HealthMemory {
  /** A pass is under way; a second one never starts (no overlap). */
  running: boolean;
  /** Failed checks in a row; a check that answers resets it. */
  failures: number;
  /** The health already written, so each state is written once. */
  health: "HEALTHY" | "UNHEALTHY" | "UNKNOWN" | null;
  /** The cloud reconcile ran in this process (an unreadable cloud retries). */
  reconciled: boolean;
}

export function newHealthMemory(): HealthMemory {
  return { running: false, failures: 0, health: null, reconciled: false };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A Go back whose deployment hadn't settled when the agent stopped waiting. */
export interface RollbackSettle {
  /** The version being made live again. */
  number: number;
  /** The version the document still has live (the code goes back to it on a failure). */
  previous: number | null;
  /** When the reconcile first saw it (ms); it gives up `SETTLE_EXPIRY_MS` later. */
  since?: number;
}

/** A Go back still unsettled after this long is dropped; the cloud's current state is followed. */
export const SETTLE_EXPIRY_MS = 30 * 60_000;

/** The deployment hasn't finished (neither READY nor ended). */
function inFlight(status: string): boolean {
  return status !== "READY" && status !== "FAILED" && status !== "SUPERSEDED";
}

function ended(status: string): boolean {
  return status === "FAILED" || status === "SUPERSEDED";
}

let pendingSettle: RollbackSettle | null = null;

/** Ask the reconcile to settle a Go back from the cloud's record (every pass until it does). */
export function awaitRollbackSettle(settle: RollbackSettle | null): void {
  pendingSettle = settle;
}

/** The Go back the reconcile still has to settle, if any. */
export function rollbackSettlePending(): RollbackSettle | null {
  return pendingSettle;
}

/** The code follows what is live; unsaved changes are never overwritten. */
async function followCode(
  ctx: OrchestratorContext,
  n: number,
  deps: LiveHealthDeps,
): Promise<void> {
  try {
    await deps.restoreCode(ctx, n);
  } catch (err) {
    const draft = (err as { code?: unknown }).code === "DRAFT_OPEN";
    ctx.log?.warn?.(
      `${TAG} the code stays as it is${draft ? " (unsaved changes)" : ""}, not moved to Version ${String(n)}: ${message(err)}`,
    );
  }
}

/** `refs/tags/v2` → `v2`; anything else falls back to the version's tag name. */
function tagOf(d: CloudDeployment): string {
  const prefix = "refs/tags/";
  return d.gitRef.startsWith(prefix)
    ? d.gitRef.slice(prefix.length)
    : `v${String(d.versionNumber ?? "")}`;
}

/**
 * The product document brought up to date with a READY production deployment
 * the cloud has but the document doesn't. Returns what it did, or null when
 * there is nothing safe to write.
 */
async function applyDeployment(
  ctx: OrchestratorContext,
  state: StudioProductState,
  d: CloudDeployment,
  deps: LiveHealthDeps,
): Promise<string | null> {
  const number = d.versionNumber;
  if (number == null) return null;
  const version = state.versions.find((v) => v.number === number);
  if (!version) {
    // Nothing to complete: a Version is created by START_LAUNCH, with its
    // change. The cloud is authoritative about what runs, but the document
    // cannot invent a version without one.
    ctx.log?.warn?.(
      `${TAG} the cloud says Version ${number} is live; the product has no record of it`,
    );
    return null;
  }
  const at = d.updatedAt || d.createdAt || deps.now().toISOString();
  if (version.status === "LAUNCHING" || version.status === "FAILED") {
    await dispatchProduct(ctx, [
      a.completeLaunch({
        number,
        gitTag: tagOf(d),
        sha: d.sha,
        packages: d.packages.map((p) => ({ name: p.name, version: p.version })),
        deploymentId: d.id,
        title: version.title,
        summary: null,
        changedFiles: [...version.changedFiles],
        launchedBy: d.onBehalfOf ?? version.launchedBy,
        trigger: d.trigger ?? "STUDIO_LAUNCH",
        at,
      }),
    ]);
    ctx.log?.info?.(`${TAG} Version ${number} finished going live while the Studio was down`);
    return "reconciled";
  }
  // An earlier live version: the cloud wins, and the code follows it.
  await dispatchProduct(ctx, [
    a.setLiveVersion({ number, at, deploymentId: d.id }),
  ]);
  await followCode(ctx, number, deps);
  ctx.log?.info?.(`${TAG} the cloud has Version ${number} live; the product now says so`);
  return "reconciled-live-version";
}

/**
 * The reconcile lane: once per process, never while a launch is under way;
 * every pass while a Go back is unsettled (`pendingSettle`). After a restart
 * the unsettled Go back is found again from the cloud's latest deployment.
 */
async function reconcileOnce(
  ctx: OrchestratorContext,
  state: StudioProductState,
  memory: HealthMemory,
  deps: LiveHealthDeps,
): Promise<string | null> {
  const live = state.liveVersion;
  if ((memory.reconciled && !pendingSettle) || live == null) return null;
  if (state.versions.some((v) => v.status === "LAUNCHING")) return null;
  const studioEnvironmentId = ctx.config?.environmentId;
  if (!studioEnvironmentId) return null;
  try {
    const product = await deps.readProduct(ctx, studioEnvironmentId);
    const d = product?.latestDeployment?.kind === "PRODUCTION" ? product.latestDeployment : null;
    const nowMs = deps.now().getTime();
    let settle = pendingSettle;

    if (settle) {
      settle.since ??= nowMs;
      if (!d || d.versionNumber !== settle.number) {
        // The cloud moved on (a later launch or Go back): follow it instead.
        ctx.log?.info?.(`${TAG} going back to Version ${String(settle.number)} was overtaken; following the cloud`);
        pendingSettle = settle = null;
      } else if (nowMs - settle.since > SETTLE_EXPIRY_MS) {
        ctx.log?.error?.(
          `${TAG} going back to Version ${String(settle.number)} didn't settle in ${String(SETTLE_EXPIRY_MS / 60_000)} min; following the cloud`,
        );
        pendingSettle = settle = null;
        if (ended(d.status) || inFlight(d.status)) await followCode(ctx, live, deps);
      }
    } else if (!memory.reconciled && d?.versionNumber != null && d.versionNumber < live) {
      // After a restart: a Go back the Studio was waiting on when it stopped.
      const number = d.versionNumber;
      if (state.versions.some((v) => v.number === number && v.status === "PREVIOUS")) {
        if (inFlight(d.status)) {
          pendingSettle = settle = { number, previous: live, since: nowMs };
          ctx.log?.info?.(`${TAG} going back to Version ${String(number)} is still starting; waiting for it`);
        } else if (ended(d.status)) {
          memory.reconciled = true;
          await followCode(ctx, live, deps);
          ctx.log?.warn?.(`${TAG} going back to Version ${String(number)} didn't start; the code follows what is live`);
          return "rollback-failed";
        }
      }
    }

    if (settle && d) {
      if (ended(d.status)) {
        // The Go back definitely failed: the code goes back to what is live.
        pendingSettle = null;
        memory.reconciled = true;
        if (settle.previous !== null) await followCode(ctx, settle.previous, deps);
        ctx.log?.error?.(`${TAG} going back to Version ${String(settle.number)} didn't start; the code is back on what is live`);
        return "rollback-failed";
      }
      // Still starting: read again next pass (not reconciled yet).
      if (inFlight(d.status)) return null;
    }
    memory.reconciled = true;

    if (!d || d.status !== "READY") return null;
    const number = d.versionNumber;
    if (number == null) return null;
    if (number === live) {
      if (settle?.number === number) pendingSettle = null; // already recorded
      return null;
    }
    if (number < live && !state.versions.some((v) => v.number === number && v.status === "PREVIOUS")) {
      return null;
    }
    const did = await applyDeployment(ctx, state, d, deps);
    // Cleared only once recorded: a failed record is tried again next pass.
    if (settle?.number === number) pendingSettle = null;
    return did;
  } catch (err) {
    // Unreadable cloud (offline, refused, secret pending) or a failed record: try again next pass.
    ctx.log?.warn?.(`${TAG} couldn't reconcile with what the cloud has live: ${message(err)}`);
    return null;
  }
}

/** The health lane: one check, at most one health write. */
async function checkOnce(
  ctx: OrchestratorContext,
  state: StudioProductState,
  memory: HealthMemory,
  deps: LiveHealthDeps,
): Promise<string | null> {
  const url = state.liveUrl;
  if (state.liveVersion == null || !url) return null;
  memory.health ??= state.health;
  try {
    const answered = await deps.checkLive(url);
    const at = deps.now().toISOString();
    if (!answered) {
      memory.failures += 1;
      if (memory.failures >= HEALTH_FAILURES && memory.health !== "UNHEALTHY") {
        await dispatchProduct(ctx, [a.setHealth({ health: "UNHEALTHY", at })]);
        memory.health = "UNHEALTHY";
        ctx.log?.error?.(
          `${TAG} the live app at ${url} didn't answer ${String(HEALTH_FAILURES)} checks in a row`,
        );
        return "unhealthy";
      }
      return null;
    }
    memory.failures = 0;
    if (memory.health !== "HEALTHY") {
      await dispatchProduct(ctx, [a.setHealth({ health: "HEALTHY", at })]);
      memory.health = "HEALTHY";
      return "healthy";
    }
    return null;
  } catch (err) {
    ctx.log?.warn?.(`${TAG} the check failed: ${message(err)}`);
    return null;
  }
}

/**
 * One pass: reconcile, then check. Returns what it did (for logs and tests).
 * Never throws, and never overlaps a pass already under way.
 */
export async function healthPass(
  ctx: OrchestratorContext,
  memory: HealthMemory,
  over: Partial<LiveHealthDeps> = {},
): Promise<string | null> {
  if (memory.running) return null;
  memory.running = true;
  const deps = { ...defaultDeps, ...over };
  try {
    const product = await getProductDoc(ctx);
    if (!product) return null;
    const reconciled = await reconcileOnce(ctx, product.state, memory, deps);
    const health = await checkOnce(ctx, product.state, memory, deps);
    const external = await deps.syncExternal(ctx, product.state);
    return health ?? reconciled ?? (external ? `external-${external}` : null);
  } catch (err) {
    ctx.log?.error?.(`${TAG} pass failed: ${message(err)}`);
    return null;
  } finally {
    memory.running = false;
  }
}

interface HealthState extends Record<string, unknown> {
  lastPassAt: number;
  memory: HealthMemory;
  lastSlowAt: number;
  slowRunning: boolean;
}

export const liveHealthTrigger = defineTrigger<HealthState>({
  id: "live-health",
  type: "condition",
  state: () => ({ lastPassAt: 0, memory: newHealthMemory(), lastSlowAt: 0, slowRunning: false }),

  // Returns at once: the check runs detached so the shared loop (chat
  // included) never waits on the network.
  async poll(tctx) {
    const state = tctx.state;
    const ctx = tctx.commandContext as unknown as OrchestratorContext;
    // Reads only on a one-shot run (no reactor booted), and only a Studio.
    if (!ctx.folders || !ctx.config?.environmentId) return null;
    const nowMs = Date.now();
    if (!state.slowRunning && nowMs - state.lastSlowAt >= SLOW_TICK_MS) {
      state.lastSlowAt = nowMs;
      state.slowRunning = true;
      void slowTickPass(ctx).finally(() => {
        state.slowRunning = false;
      });
    }
    if (nowMs - state.lastPassAt < HEALTH_INTERVAL_MS) return null;
    state.lastPassAt = nowMs;
    void healthPass(ctx, state.memory)
      .then((did) => {
        if (did) ctx.log?.debug?.(`${TAG} ${did}`);
      })
      .catch((err: unknown) => ctx.log?.warn?.(`${TAG} pass failed: ${message(err)}`));
    return null;
  },
});
