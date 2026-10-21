import type { Action } from "document-model";
import {
  actions as productActions,
  type StudioProductState,
} from "document-models/studio-product";

type CostChange = StudioProductState["changes"][number];

/** Statuses after which the change has stopped spending. */
const ENDED = new Set(["READY", "LAUNCHED", "FAILED", "DISCARDED"]);

/**
 * What to record for each change from the Studio's current spend. Pure and
 * idempotent: a side that is already set is never produced again.
 */
export function costActions(
  product: StudioProductState,
  usageUsd: number | null,
  _now: number,
): Action[] {
  if (usageUsd === null || !Number.isFinite(usageUsd)) return [];
  const out: Action[] = [];
  for (const change of product.changes) {
    const hasStart = change.cost?.startUsd != null;
    const hasEnd = change.cost?.endUsd != null;
    if (!hasStart && change.id === product.activeChangeId) {
      out.push(
        productActions.setChangeCost({
          changeId: change.id,
          startUsd: usageUsd,
        }),
      );
    } else if (hasStart && !hasEnd && ENDED.has(change.status)) {
      out.push(
        productActions.setChangeCost({ changeId: change.id, endUsd: usageUsd }),
      );
    }
  }
  return out;
}

/** What the change cost (end minus start, never below zero), or null. */
export function changeCostUsd(change: CostChange): number | null {
  const start = change.cost?.startUsd;
  const end = change.cost?.endUsd;
  if (start == null || end == null) return null;
  return Math.max(0, end - start);
}

/** Keys of the sides already dispatched (or in flight): `${changeId}:start|end`. */
export function sideKey(action: Action): string {
  const i = action.input as { changeId: string; startUsd?: number };
  return `${i.changeId}:${i.startUsd !== undefined ? "start" : "end"}`;
}
