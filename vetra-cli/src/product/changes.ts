/**
 * Changes after launch (spec §5.7, D13, D17): one change at a time, each with
 * its own conversation, built from the live version's code.
 *
 * The browser starts every change (`startChange` in the Studio: a new
 * conversation, `START_CHANGE`, the request as its first message; a request
 * while a change is open joins that change instead). The agent's side is
 * this module: when a new CHANGE or UNDO becomes active, the reactor projects
 * must hold the live version's code, so a change never builds on leftovers
 * (a stray edit, an older draft). It runs inside the agent's turn, before the
 * model's first step (`ChangeBaseProcessor`), at most once per change (a git
 * ref records it), and never destroys anything: code that isn't the live
 * version's is first kept under `refs/vetra/unsaved/…`. Discard
 * (`discardChange` in the launch orchestrator) puts the code back the same
 * way and keeps the change in the story, marked DISCARDED.
 */
import type { Change, StudioProductState } from "vetra-app/document-models/studio-product";
import {
  discardDraft,
  draftMatches,
  hasChangeBase,
  hasChangeUnbased,
  markChangeBase,
  markChangeUnbased,
  versionTag,
} from "../launch/git-versions.js";
import { getProductDoc, type ProductContext } from "./product-doc.js";

const TAG = "[changes]";

/** What `prepareChangeBase` did. */
export type ChangeBaseOutcome = "restored" | "unchanged" | "already" | "unbased" | "skipped";

export interface ChangeBaseContext extends ProductContext {
  workdir: string;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

export interface ChangeBaseDeps {
  draftMatches: typeof draftMatches;
  discardDraft: typeof discardDraft;
  hasChangeBase: typeof hasChangeBase;
  markChangeBase: typeof markChangeBase;
  hasChangeUnbased: typeof hasChangeUnbased;
  markChangeUnbased: typeof markChangeUnbased;
}

const defaultDeps: ChangeBaseDeps = {
  draftMatches,
  discardDraft,
  hasChangeBase,
  markChangeBase,
  hasChangeUnbased,
  markChangeUnbased,
};

/** Statuses a forced base may be prepared in (never while going live). */
const IN_PROGRESS_FOR_BASE: readonly string[] = ["BUILDING", "PAUSED", "READY"];

/** The live version's git tag, or null when nothing is live. */
export function liveTag(state: StudioProductState): string | null {
  if (state.liveVersion == null) return null;
  const live = state.versions.find((v) => v.number === state.liveVersion);
  return live?.gitTag || versionTag(state.liveVersion);
}

/**
 * Whether `change` is a change after launch the agent hasn't started on yet:
 * a CHANGE or UNDO, BUILDING, with no step planned. Once it plans, the code
 * is the change's and is never reset from here.
 */
export function awaitsBase(change: Change): boolean {
  return (
    (change.kind === "CHANGE" || change.kind === "UNDO") &&
    change.status === "BUILDING" &&
    change.steps.length === 0
  );
}

/**
 * Make a new change start from the live version's code (F19), once: when
 * `change` awaits its base, nothing marks it prepared yet
 * (`refs/vetra/change-base/<id>`) and the reactor projects aren't the live
 * tag's, keep them under `refs/vetra/unsaved/<id>-<ms>` and restore the live
 * code with `discardDraft`; then mark the change prepared. `opts.state` is the
 * product state when the caller has it (else it is read). A change a turn
 * already worked on without its base (`refs/vetra/change-unbased/<id>`) is
 * never reset: it is marked prepared as it is (`unbased`). Throws when git
 * fails (nothing is marked).
 */
export async function prepareChangeBase(
  ctx: ChangeBaseContext,
  change: Change,
  opts: { state?: StudioProductState; deps?: Partial<ChangeBaseDeps>; force?: boolean } = {},
): Promise<ChangeBaseOutcome> {
  const d = { ...defaultDeps, ...opts.deps };
  // `force`: a CHANGE/UNDO with steps planned that was never prepared (a Studio
  // edit whose base failed); the refs below still guard work already done.
  const eligible = opts.force
    ? (change.kind === "CHANGE" || change.kind === "UNDO") && IN_PROGRESS_FOR_BASE.includes(change.status)
    : awaitsBase(change);
  if (!eligible) return "skipped";
  const state = opts.state ?? (await getProductDoc(ctx))?.state;
  const tag = state ? liveTag(state) : null;
  if (!tag) return "skipped";
  if (await d.hasChangeBase(ctx.workdir, change.id)) return "already";
  if (await d.hasChangeUnbased(ctx.workdir, change.id)) {
    // A turn already worked on this change: its edits stand, never reverted.
    ctx.log?.warn?.(
      `${TAG} change ${change.id} went on before its code was set to ${tag}; it keeps the code it started from`,
    );
    await d.markChangeBase(ctx.workdir, change.id, tag);
    return "unbased";
  }
  let outcome: ChangeBaseOutcome = "unchanged";
  if (!(await d.draftMatches(ctx.workdir, tag))) {
    const unsaved = await d.discardDraft(ctx.workdir, tag, { label: change.id });
    ctx.log?.info?.(
      `${TAG} change ${change.id} starts from ${tag}; the code that was there is kept at ${unsaved ?? "(nothing to keep)"}`,
    );
    outcome = "restored";
  }
  await d.markChangeBase(ctx.workdir, change.id, tag);
  return outcome;
}
