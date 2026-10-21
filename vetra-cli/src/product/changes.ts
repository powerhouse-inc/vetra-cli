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
 *
 * Bring them in (D15): the page starts a CHANGE whose request is
 * `BRING_IN_REQUEST`. Once its base is set, `main` is fetched from the
 * product's GitHub repository into `refs/vetra/github/main` and merged into
 * the working tree without a commit (the change's version completes the
 * merge, so the next mirror is a fast-forward); the agent is told what came
 * in, or which files conflict, through `note`. Such a change is never
 * launched by itself (orchestrator `autoLaunchCandidate`).
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
import { LaunchError } from "../launch/errors.js";
import { DEFAULT_AUTHOR } from "../launch/git-versions.js";
import { MIRROR_REASONS, gitWithToken, mirrorDepsOf, type MirrorContext } from "../launch/mirror.js";

const TAG = "[changes]";

/** What `prepareChangeBase` did. */
export type ChangeBaseOutcome = "restored" | "unchanged" | "already" | "unbased" | "skipped";

export interface ChangeBaseContext extends ProductContext {
  workdir: string;
  /** For Bring them in: the cloud (push token) and its test seams. */
  config?: MirrorContext["config"];
  mirrorDeps?: MirrorContext["mirrorDeps"];
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

/**
 * The request text of the change that brings in changes made on GitHub —
 * the same text as vetra-app's `BRING_IN_REQUEST` (a test keeps them equal;
 * the CLI doesn't load the model's React hooks barrel).
 */
export const BRING_IN_REQUEST = "Bring in the changes made on GitHub";

/** Whether `change` is the one that brings in changes made on GitHub. */
export function isBringIn(change: Pick<Change, "kind" | "request">): boolean {
  return change.kind === "CHANGE" && change.request.trim() === BRING_IN_REQUEST;
}

/** Where GitHub's `main` is fetched to (never a branch: `main` stays the Studio's). */
export const GITHUB_MAIN_REF = "refs/vetra/github/main";

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
  opts: {
    state?: StudioProductState;
    deps?: Partial<ChangeBaseDeps>;
    /** Receives what the agent must know for this turn (Bring them in). */
    note?: (text: string) => void;
  } = {},
): Promise<ChangeBaseOutcome> {
  const d = { ...defaultDeps, ...opts.deps };
  if (!awaitsBase(change)) return "skipped";
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
  if (state && isBringIn(change)) {
    const text = await bringIn(ctx, state);
    opts.note?.(text);
  }
  return outcome;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DONT_COMMIT = "Don't commit or push: the launch saves it.";

/**
 * Fetch GitHub's `main` and merge it into the working tree (no commit).
 * Returns the note for the agent; never throws.
 */
export async function bringIn(ctx: ChangeBaseContext, state: StudioProductState): Promise<string> {
  const failed = (reason: string) =>
    `The customer asked to bring in the changes made on GitHub, but they couldn't be fetched (${reason}). ` +
    "Tell them in one sentence, and that they can discard this change and choose Bring them in again. Change nothing.";
  if (!state.appId || !ctx.config) return failed(MIRROR_REASONS.notConnected);
  const mctx: MirrorContext = { ...ctx, config: ctx.config, log: ctx.log };
  const d = mirrorDepsOf(mctx);
  const git = (args: string[]) => d.git(ctx.workdir, args, { author: DEFAULT_AUTHOR });
  let sha: string;
  try {
    let token;
    try {
      token = await d.pushToken(mctx, state.appId);
    } catch (err) {
      const unavailable = err instanceof LaunchError && err.code === "CLOUD_UNAVAILABLE";
      throw new LaunchError(
        "BRING_IN_FAILED",
        unavailable ? "Vetra didn't answer" : MIRROR_REASONS.notConnected,
        message(err),
      );
    }
    await gitWithToken(mctx, ["fetch", "--no-tags", token.remoteUrl, `+refs/heads/main:${GITHUB_MAIN_REF}`], token);
    sha = await git(["rev-parse", "--verify", `${GITHUB_MAIN_REF}^{commit}`]);
  } catch (err) {
    ctx.log?.warn?.(`${TAG} changes made on GitHub not fetched: ${message(err)}`);
    return failed(err instanceof LaunchError ? err.reason : MIRROR_REASONS.notAnswering);
  }
  const short = sha.slice(0, 12);
  let inStudio = true;
  try {
    await git(["merge-base", "--is-ancestor", sha, "HEAD"]);
  } catch {
    inStudio = false;
  }
  if (inStudio) {
    ctx.log?.info?.(`${TAG} GitHub's main (${short}) is already in the Studio`);
    return (
      `The changes made on GitHub (commit ${short}) are already in this Studio's code; there is nothing to bring in. ` +
      "Tell the customer in one sentence."
    );
  }
  try {
    await git(["merge", "--no-ff", "--no-commit", GITHUB_MAIN_REF]);
    ctx.log?.info?.(`${TAG} GitHub's main (${short}) merged into the change`);
    return (
      `Bring them in: the changes made on GitHub (commit ${short}) are merged into this change's files; ` +
      "the version you launch completes the merge. Look at what came in (git diff --cached --stat), run the checks, " +
      `fix anything the changes broke, then tell the customer in one or two sentences what came in. ${DONT_COMMIT}`
    );
  } catch (mergeErr) {
    let files: string[] = [];
    try {
      files = (await git(["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
    } catch {
      // listed as none
    }
    if (files.length === 0) {
      ctx.log?.warn?.(`${TAG} changes made on GitHub not merged: ${message(mergeErr)}`);
      return failed("they couldn't be combined with your Studio's code");
    }
    ctx.log?.info?.(`${TAG} GitHub's main (${short}) merged with ${files.length} conflicting file(s)`);
    return (
      `Bring them in: the changes made on GitHub (commit ${short}) are merged into this change's files, but these files ` +
      `conflict with the Studio's code: ${files.join(", ")}. Resolve each conflict (keep what both sides meant and remove the ` +
      `conflict markers), run the checks, then tell the customer in one or two sentences what came in. ${DONT_COMMIT}`
    );
  }
}
