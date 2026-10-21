/**
 * Deploy and verify steps of a launch: follow the cloud deployment until it
 * settles, then check the live address answers.
 *
 * `waitForDeployment` polls (one short request every few seconds) instead of
 * holding a request open, so nothing ever waits on a long HTTP call (the
 * ingress cuts requests at 30 s). The read is the cloud's binding-checked
 * `studioDeployment` (Task 2.3). Short network blips, 5xx, 408 and 429 are
 * tolerated; a refusal (permission, binding, any other 4xx) ends the wait at once.
 */
import { LaunchError } from "./errors.js";
import { studioGql, type CloudContext } from "./cloud-launch.js";

/** The plain reason for `FAIL_LAUNCH` when the deployment failed (F39). */
export const DEPLOY_FAILED_REASON = "the new version didn't start";

/**
 * `timedOut`: the deployment hadn't settled when the wait gave up — it may
 * still become READY (not a definite failure).
 */
export type DeploymentOutcome = "READY" | { failed: string; detail?: string; timedOut?: true };

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Errors worth another poll: the cloud didn't answer, not a refusal. */
function transient(err: unknown): boolean {
  return err instanceof LaunchError && err.code === "CLOUD_UNAVAILABLE";
}

/**
 * Wait until the deployment is READY or has failed (FAILED / SUPERSEDED), at
 * most `timeoutMs` (default 15 min). `failed` is the plain reason; `detail`
 * carries the cloud's own error text for the logs.
 */
export async function waitForDeployment(
  ctx: CloudContext,
  id: string,
  opts: WaitOptions = {},
): Promise<DeploymentOutcome> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const intervalMs = opts.intervalMs ?? 5_000;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      const data = await studioGql<{
        studioDeployment: { id: string; status: string; error: string | null } | null;
      }>(
        ctx,
        "studioDeployment",
        `query StudioDeployment($id: ID!) { studioDeployment(id: $id) { id status error } }`,
        { id },
      );
      const d = data.studioDeployment;
      if (!d) {
        return { failed: DEPLOY_FAILED_REASON, detail: `Deployment ${id} not found.` };
      }
      if (d.status === "READY") return "READY";
      if (d.status === "FAILED" || d.status === "SUPERSEDED") {
        return { failed: DEPLOY_FAILED_REASON, detail: d.error ?? `Deployment ${d.status}.` };
      }
    } catch (err) {
      if (!transient(err)) throw err;
    }
    if (now() >= deadline) {
      return {
        failed: DEPLOY_FAILED_REASON,
        detail: `Deployment ${id} did not settle within ${Math.round(timeoutMs / 1000)} s.`,
        timedOut: true,
      };
    }
    await sleep(intervalMs);
  }
}

export interface CheckLiveOptions {
  tries?: number;
  intervalMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** True when the live address answers HTTP 200 within 3 tries, 10 s apart. */
export async function checkLive(url: string, opts: CheckLiveOptions = {}): Promise<boolean> {
  const tries = opts.tries ?? 3;
  const intervalMs = opts.intervalMs ?? 10_000;
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await doFetch(url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200) return true;
    } catch {
      // Not answering yet; try again.
    }
    if (attempt < tries) await sleep(intervalMs);
  }
  return false;
}
