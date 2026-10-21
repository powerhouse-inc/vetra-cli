/** A live product with a change open on it (Task 3.5 tests). */
import {
  actions,
  reducer,
  type ChangeStatus,
  type StudioProductAction,
  type StudioProductDocument,
  type StudioProductState,
} from "document-models/studio-product";
import { readProduct } from "../shell/useStudioState.js";
import {
  at,
  buildingOps,
  productDoc,
  withLiveVersion,
} from "../test-utils/studioFixtures.js";

export const CHANGE_ID = "c2";
export const CHANGE_SESSION = "session-2";
export const LIVE_URL = "https://task-board.vetra.io";
export const REQUEST = "Add a notes for the kitchen field";

/** Version 1 ("First version") live, from the first build c1. */
export function liveDoc(): StudioProductDocument {
  const doc = withLiveVersion(productDoc(...buildingOps()), {
    liveUrl: LIVE_URL,
    launchedAt: at(25),
  });
  doc.state.global.versions[0].title = "First version";
  return doc;
}

export function apply(
  doc: StudioProductDocument,
  ...ops: StudioProductAction[]
): StudioProductDocument {
  const next = ops.reduce((d, op) => reducer(d, op), doc);
  const failed = next.operations.global.find((o) => o.error);
  if (failed) throw new Error(`fixture op failed: ${failed.error}`);
  return next;
}

/** Change c2 open on the live product, Data 1/1 working. */
export function changingDoc(): StudioProductDocument {
  return apply(
    liveDoc(),
    actions.startChange({
      id: CHANGE_ID,
      kind: "CHANGE",
      request: REQUEST,
      chatSessionId: CHANGE_SESSION,
      startedAt: at(30),
    }),
    actions.planSteps({
      changeId: CHANGE_ID,
      steps: [
        { kind: "DATA", total: 1 },
        { kind: "EDITORS" },
        { kind: "TESTS" },
        { kind: "LIVE" },
      ],
    }),
    actions.startStep({ changeId: CHANGE_ID, kind: "DATA", at: at(31) }),
    actions.countStep({
      changeId: CHANGE_ID,
      kind: "DATA",
      done: 1,
      total: 1,
    }),
  );
}

/** The open change with its status set (READY: its checks passed). */
export function changing(
  status: ChangeStatus = "BUILDING",
  doc: StudioProductDocument = changingDoc(),
): StudioProductState {
  const product = readProduct(doc.state.global);
  const change = product.changes.find((c) => c.id === CHANGE_ID);
  if (!change) throw new Error("no change c2");
  change.status = status;
  if (status === "READY") {
    change.title = "Notes for the kitchen";
    change.metrics.readyAt = at(40);
    for (const step of change.steps) {
      if (step.kind !== "LIVE") step.status = "DONE";
    }
  }
  return product;
}
