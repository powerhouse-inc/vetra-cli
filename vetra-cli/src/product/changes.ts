/**
 * Changes after launch (spec §5.7, D13, D17): one change at a time, each with
 * its own conversation, built from the live version's code.
 *
 * The browser starts every change (`startChange` in the Studio: a new
 * conversation, `START_CHANGE`, the request as its first message; a request
 * while a change is open joins that change instead). The agent's side is
 * this module: when a new CHANGE or UNDO becomes active, the reactor projects
 * must hold the live version's code, so a change never builds on leftovers
 * (a stray edit, an older draft). Discard (`discardChange` in the launch
 * orchestrator) puts the code back the same way and keeps the change in the
 * story, marked DISCARDED.
 */
import type { Change, StudioProductState } from "vetra-app/document-models/studio-product";
import { discardDraft, draftMatches, versionTag } from "../launch/git-versions.js";
import { getProductDoc, type ProductContext } from "./product-doc.js";

const TAG = "[changes]";

/** What `prepareChangeBase` did. */
export type ChangeBaseOutcome = "restored" | "unchanged" | "skipped";

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
}

const defaultDeps: ChangeBaseDeps = { draftMatches, discardDraft };

/** The live version's git tag, or null when nothing is live. */
export function liveTag(state: StudioProductState): string | null {
  if (state.liveVersion == null) return null;
  const live = state.versions.find((v) => v.number === state.liveVersion);
  return live?.gitTag || versionTag(state.liveVersion);
}

/**
 * Whether `change` is a change after launch the agent hasn't started on yet:
 * a CHANGE or UNDO, BUILDING, with no step planned. Until the plan exists the
 * agent only has the plan's tools, so the project code is still untouched;
 * once it plans, the code is the change's and is never reset from here.
 */
export function awaitsBase(change: Change): boolean {
  return (
    (change.kind === "CHANGE" || change.kind === "UNDO") &&
    change.status === "BUILDING" &&
    change.steps.length === 0
  );
}

/**
 * Make a new change start from the live version's code (F19): when `change`
 * awaits its base and the reactor projects aren't the live tag's, restore
 * them with `discardDraft` (a `Discard change` commit when HEAD moved, else a
 * working-tree reset; product specs and chats are kept). `opts.state` is the
 * product state when the caller has it (else it is read). Throws when git
 * fails, so the caller can retry on its next pass.
 */
export async function prepareChangeBase(
  ctx: ChangeBaseContext,
  change: Change,
  opts: { state?: StudioProductState; deps?: Partial<ChangeBaseDeps> } = {},
): Promise<ChangeBaseOutcome> {
  const d = { ...defaultDeps, ...opts.deps };
  if (!awaitsBase(change)) return "skipped";
  const state = opts.state ?? (await getProductDoc(ctx))?.state;
  const tag = state ? liveTag(state) : null;
  if (!tag) return "skipped";
  if (await d.draftMatches(ctx.workdir, tag)) return "unchanged";
  await d.discardDraft(ctx.workdir, tag);
  ctx.log?.info?.(`${TAG} change ${change.id} starts from ${tag}; earlier unsaved code was put back`);
  return "restored";
}
