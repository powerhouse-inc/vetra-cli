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
import { IN_PROGRESS, getProductDoc, type ProductContext } from "./product-doc.js";
import { LaunchError } from "../launch/errors.js";
import { DEFAULT_AUTHOR, unfinishedMergePaths, workspaceGit } from "../launch/git-versions.js";
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
  if (await d.hasChangeBase(ctx.workdir, change.id)) {
    const reminder = await bringInReminder(ctx, change);
    if (reminder) opts.note?.(reminder);
    return "already";
  }
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
  // Before the mark: a restart in between prepares (and brings in) again
  // rather than losing it.
  if (state && isBringIn(change)) {
    const text = await bringIn(ctx, state);
    opts.note?.(text);
  }
  await d.markChangeBase(ctx.workdir, change.id, tag);
  return outcome;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DONT_COMMIT = "Don't commit or push: the launch saves it.";

/** Plain reasons a bring-in stops before merging. */
export const BRING_IN_REASONS = {
  runtimeDir: "the code on GitHub contains a .ph folder, which a Studio never takes from outside",
  overwrite: "files in your Studio that aren't saved yet would be overwritten",
  unrelated: "the code on GitHub doesn't share any history with your Studio",
  other: "they couldn't be combined with your Studio's code",
} as const;

/** git's merge refusal in plain words. */
export function mergeFailure(detail: string): string {
  if (/would be overwritten by merge|untracked working tree files would be/i.test(detail)) {
    return BRING_IN_REASONS.overwrite;
  }
  if (/refusing to merge unrelated histories/i.test(detail)) return BRING_IN_REASONS.unrelated;
  return BRING_IN_REASONS.other;
}

/**
 * Fetch GitHub's `main` and merge it into the working tree (no commit).
 * Returns the note for the agent; never throws.
 */
export async function bringIn(ctx: ChangeBaseContext, state: StudioProductState): Promise<string> {
  const notMerged = (reason: string) =>
    `The customer asked to bring in the changes made on GitHub, but they couldn't be brought in (${reason}). ` +
    "Tell them in one sentence what they can do about it. Change nothing.";
  const failed = (reason: string) =>
    `The customer asked to bring in the changes made on GitHub, but they couldn't be fetched (${reason}). ` +
    "Tell them in one sentence, and that they can discard this change and choose Bring them in again. Change nothing.";
  if (!state.appId || !ctx.config) return failed(MIRROR_REASONS.notConnected);
  const mctx: MirrorContext = { ...ctx, config: ctx.config, log: ctx.log };
  const d = mirrorDepsOf(mctx);
  // Untranslated messages, so `mergeFailure` reads them.
  const git = (args: string[]) => d.git(ctx.workdir, args, { author: DEFAULT_AUTHOR, env: { LC_ALL: "C" } });
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
    const reason = err instanceof LaunchError ? err.reason : MIRROR_REASONS.notAnswering;
    ctx.log?.warn?.(`${TAG} changes made on GitHub not fetched (${reason}): ${message(err)}`);
    return failed(reason);
  }
  // The agent runtime directory never comes from outside (keys, credentials).
  const tracked = await git(["ls-tree", "-r", "--name-only", GITHUB_MAIN_REF]);
  if (tracked.split("\n").some((p) => /(^|\/)\.ph(\/|$)/.test(p))) {
    ctx.log?.warn?.(`${TAG} GitHub's main tracks a .ph directory; not brought in`);
    return notMerged(BRING_IN_REASONS.runtimeDir);
  }
  const short = sha.slice(0, 12);
  // Already merged (a turn prepared again with the merge left in place).
  let mergeHead: string | null = null;
  try {
    mergeHead = await git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  } catch {
    mergeHead = null;
  }
  if (mergeHead === sha) {
    ctx.log?.info?.(`${TAG} GitHub's main (${short}) is already merged into the change`);
    const open = await unfinishedMergePaths(ctx.workdir);
    return open.length > 0
      ? conflictNote(short, open)
      : `Bring them in: the changes made on GitHub (commit ${short}) are already merged into this change's files and ` +
          `the version you launch completes the merge; don't merge again. ${DONT_COMMIT}`;
  }
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
      const reason = mergeFailure(message(mergeErr));
      ctx.log?.warn?.(`${TAG} changes made on GitHub not merged (${reason}): ${message(mergeErr)}`);
      return notMerged(reason);
    }
    ctx.log?.info?.(`${TAG} GitHub's main (${short}) merged with ${files.length} conflicting file(s)`);
    return conflictNote(short, files);
  }
}

function conflictNote(short: string, files: string[]): string {
  return (
    `Bring them in: the changes made on GitHub (commit ${short}) are merged into this change's files, but these files ` +
    `conflict with the Studio's code: ${files.join(", ")}. Resolve each conflict (keep what both sides meant and remove the ` +
    `conflict markers) and \`git add\` it, run the checks, then tell the customer in one or two sentences what came in. ${DONT_COMMIT}`
  );
}

/**
 * For later turns of an open Bring them in change: while its merge still has
 * unmerged or conflict-marked files, the conflict note again (else null).
 */
export async function bringInReminder(ctx: Pick<ChangeBaseContext, "workdir">, change: Change): Promise<string | null> {
  if (!isBringIn(change) || !IN_PROGRESS.includes(change.status)) return null;
  const open = await unfinishedMergePaths(ctx.workdir);
  if (open.length === 0) return null;
  let sha = "";
  try {
    sha = await workspaceGit(ctx.workdir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  } catch {
    return null;
  }
  return conflictNote(sha.slice(0, 12), open);
}
