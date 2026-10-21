/**
 * Go back (spec §5.7, §6.5, designer's call D6): make an earlier version
 * live again, only when the product's data can live with it.
 *
 * `goBack(ctx, m)`:
 * 1. the data check (compat-rollback.ts): no document in the product drive
 *    may use a document type or operation added after Version m. When it
 *    does, `SET_ROLLBACK_BLOCK m` records the row's sentence ("Can't go back
 *    automatically: Version <k> added data …") and the request fails with it;
 *    the customer's way forward is **Undo with the agent** (the Versions
 *    panel starts a change `Undo '<title of k>' but keep existing data`).
 *    When the check can't run while the drive holds documents, Go back fails
 *    closed with a plain reason (trying again runs it again).
 * 2. `rollbackTo` (orchestrator): the code goes back to `v<m>` (refused while
 *    the Studio has unsaved changes), the cloud re-deploys Version m's
 *    deployment and waits for READY, then `SET_LIVE_VERSION m`. On a cloud
 *    failure the code is put back on the live version.
 * 3. the blocked rows are worked out again for the new live version (F26).
 *
 * Nothing here writes to the product drive: the check only reads it, and
 * versions after m stay listed and can be made live again. Restart (F15)
 * never comes through here.
 */
import { onSlowTick } from "../triggers/live-health.js";
import { dispatchProduct, getProductDoc, productActions as a } from "../product/product-doc.js";
import {
  checkVersion,
  readUsed,
  refreshRollbackBlocks,
  rollbackUncheckedReason,
  type CompatRollbackContext,
  type GoBackCheck,
} from "./compat-rollback.js";
import {
  recordRequestFailure,
  rollbackTo,
  type OrchestratorContext,
  type RequestOutcome,
} from "./orchestrator.js";

export type GoBackContext = OrchestratorContext & CompatRollbackContext;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nowIso(ctx: GoBackContext): string {
  return (ctx.now ?? (() => new Date()))().toISOString();
}

/** The Go back request: the data check, then the rollback, then F26's refresh. */
export async function goBack(ctx: GoBackContext, m: number): Promise<RequestOutcome> {
  const state = (await getProductDoc(ctx))?.state;
  if (state) {
    let check: GoBackCheck;
    try {
      check = await checkVersion(ctx, state, m, await readUsed(ctx, state));
    } catch (err) {
      const reason = rollbackUncheckedReason(m);
      ctx.log?.error?.(`[go back] Version ${m}: the data check couldn't run, not going back: ${message(err)}`);
      await recordRequestFailure(ctx, "ROLLBACK", reason);
      return { status: "REFUSED", reason };
    }
    if (!check.ok) {
      ctx.log?.warn?.(`[go back] Version ${m} refused, the data uses: ${check.what.join("; ")}`);
      try {
        await dispatchProduct(ctx, [
          a.setRollbackBlock({ number: m, reason: check.reason }),
          a.failRequest({ kind: "ROLLBACK", reason: check.reason, at: nowIso(ctx) }),
        ]);
      } catch (err) {
        ctx.log?.error?.(`[go back] Version ${m}: the refusal couldn't be recorded: ${message(err)}`);
        await recordRequestFailure(ctx, "ROLLBACK", check.reason);
      }
      return { status: "REFUSED", reason: check.reason };
    }
  }
  const outcome = await rollbackTo(ctx, m);
  if (outcome.status === "DONE") await refreshRollbackBlocks(ctx);
  return outcome;
}

// F26: every 10 minutes on the live-health tick.
onSlowTick((ctx) => refreshRollbackBlocks(ctx as GoBackContext).then(() => undefined));
