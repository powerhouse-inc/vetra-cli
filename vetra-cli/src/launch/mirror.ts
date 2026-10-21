/**
 * GitHub as a mirror (spec §8, D1/D14/D15): when the product has a
 * repository, every launch pushes `main` and the version tags there, and
 * connecting pushes the whole history (every launched version's tag).
 *
 * - The token is short-lived (`studioPushToken`, Studio binding) and never
 *   touches disk, a command line, a log or the git config: it reaches git as
 *   an `http.extraHeader` through the environment (`GIT_CONFIG_COUNT/KEY/VALUE`)
 *   of that one process, and is redacted from any error.
 * - The commit is recorded with the cloud (`recordStudioMirror`) *before* the
 *   push (F25b), so the push webhook never mistakes the Studio's own push for
 *   a change made on GitHub. A cloud that doesn't know the call yet is fine.
 * - Nothing is ever forced: when `main` on GitHub has commits the Studio
 *   doesn't, the push is refused and the reason says so; "Bring them in"
 *   (changes.ts) merges them into the next change.
 * - A mirror never throws and never fails a launch: the result is recorded
 *   with `SET_GITHUB` (CONNECTED / PUSH_FAILED / DISCONNECTED) and returned.
 *
 * Every git call goes through `workspaceGit` (safe.directory scoped to the
 * workspace), after a pre-check that fails with git's own error.
 */
import type { StudioProductState } from "vetra-app/document-models/studio-product";
import {
  GITHUB_NOT_CONNECTED_CODE,
  cloudClearExternalChanges,
  cloudExternalChanges,
  cloudPushToken,
  cloudRecordMirror,
  isUnsupported,
  redact,
  type CloudContext,
  type PushToken,
} from "./cloud-launch.js";
import { LaunchError } from "./errors.js";
import { MAIN_BRANCH, workspaceGit, type WorkspaceGitOptions } from "./git-versions.js";
import { dispatchProduct, getProductDoc, productActions as a, type ProductContext } from "../product/product-doc.js";

const TAG = "[mirror]";
/** Where the product's repositories live; the token header is sent only there. */
export const GITHUB_ORIGIN = "https://github.com";
/** A push or fetch that takes longer than this is given up (the launch is already live). */
export const GIT_NETWORK_TIMEOUT_MS = 120_000;

/** Plain reasons for the failure line (the page composes the sentence, F39). */
export const MIRROR_REASONS = {
  notConnected: "GitHub isn't connected",
  nothingLive: "nothing is live yet",
  noToken: "GitHub didn't let Vetra in",
  diverged: "there are changes on GitHub that aren't in your Studio",
  /** The push token can't write `.github/workflows/` (contents:write only, Task 4.1). */
  workflows: "your code has GitHub workflow files, which Vetra can't save to GitHub",
  tagMoved: "a version on GitHub doesn't match the one in your Studio",
  refused: "GitHub refused the code",
  notAnswering: "GitHub didn't answer",
  unreadable: "the code in your Studio couldn't be read",
} as const;

/** The failure line, exactly as the spec words it (logs; the page composes the same). */
export function mirrorFailureText(reason: string): string {
  const plain = reason.trim().replace(/[.\s]+$/, "");
  return `Couldn't save to GitHub (${plain}). Will retry with the next launch.`;
}

export type MirrorResult = { sha: string } | { failed: string } | { skipped: string };

export interface MirrorDeps {
  pushToken: (ctx: CloudContext, appId: string) => Promise<PushToken>;
  recordMirror: (ctx: CloudContext, appId: string, sha: string) => Promise<boolean>;
  clearExternalChanges: (ctx: CloudContext, appId: string) => Promise<boolean>;
  externalChanges: (ctx: CloudContext, studioEnvironmentId: string) => Promise<string | null | undefined>;
  git: (workdir: string, args: string[], opts?: WorkspaceGitOptions) => Promise<string>;
}

const defaultDeps: MirrorDeps = {
  pushToken: cloudPushToken,
  recordMirror: cloudRecordMirror,
  clearExternalChanges: cloudClearExternalChanges,
  externalChanges: cloudExternalChanges,
  git: workspaceGit,
};

export interface MirrorContext extends ProductContext, CloudContext {
  workdir: string;
  log?: CloudContext["log"];
  mirrorDeps?: Partial<MirrorDeps>;
}

export function mirrorDepsOf(ctx: MirrorContext): MirrorDeps {
  return { ...defaultDeps, ...ctx.mirrorDeps };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `owner/name` from `https://github.com/owner/name.git` (or any URL/path ending so). */
export function repoFullName(remoteUrl: string): string | null {
  const parts = remoteUrl
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

/**
 * The environment that gives one git process the token, as an HTTP header:
 * `GIT_CONFIG_COUNT/KEY/VALUE` are read like `-c` but stay off the command
 * line; any credential helper is switched off by the caller (`-c
 * credential.helper=`), so nothing stores it.
 */
export function tokenEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    // Scoped to GitHub: the header never goes to any other host.
    GIT_CONFIG_KEY_0: `http.${GITHUB_ORIGIN}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    // git's messages untranslated, so `classify` reads them.
    LC_ALL: "C",
  };
}

/** Every form of the token that could show up in git's output. */
function tokenForms(token: string): string[] {
  return [token, Buffer.from(`x-access-token:${token}`).toString("base64")];
}

/** No credential helper may see (or store) anything for these calls. */
const NO_HELPER = ["-c", "credential.helper="];

/**
 * Run a networked git command with the token. Throws a `LaunchError` whose
 * message is redacted; `reason` classifies git's refusal in plain words.
 */
export async function gitWithToken(
  ctx: MirrorContext,
  args: string[],
  push: PushToken,
): Promise<string> {
  const d = mirrorDepsOf(ctx);
  try {
    return await d.git(ctx.workdir, args, {
      env: tokenEnv(push.token),
      config: NO_HELPER,
      timeoutMs: GIT_NETWORK_TIMEOUT_MS,
      reason: MIRROR_REASONS.notAnswering,
    });
  } catch (err) {
    const detail = redact(message(err), tokenForms(push.token));
    throw new LaunchError("MIRROR_FAILED", classify(detail), detail);
  }
}

/**
 * git's refusal in plain words, from its per-ref status lines (`! [rejected]
 * <src> -> <dst> (<why>)`; not translated, unlike the hints). With
 * `--atomic` the refs that were fine are listed as "(atomic push failed)":
 * those say nothing about the cause and are ignored.
 */
export function classify(detail: string): string {
  if (/create or update workflow|without `?workflows`? permission/i.test(detail)) {
    return MIRROR_REASONS.workflows;
  }
  if (/\[rejected\]\s+\S+ -> \S+ \(already exists\)|would clobber existing tag/.test(detail)) {
    return MIRROR_REASONS.tagMoved;
  }
  if (/\[rejected\]\s+main -> main \((?:fetch first|non-fast-forward)\)/.test(detail)) {
    return MIRROR_REASONS.diverged;
  }
  if (/\[remote rejected\]/.test(detail)) return MIRROR_REASONS.refused;
  if (/\b(?:401|403)\b|Authentication failed|Permission to \S+ denied|Repository not found|Invalid username or password/i.test(detail)) {
    return MIRROR_REASONS.refused;
  }
  return MIRROR_REASONS.notAnswering;
}

/** The tags of every version that went live (a FAILED or LAUNCHING one may still move, F23). */
export function launchedTags(state: StudioProductState): string[] {
  return state.versions
    .filter((v) => (v.status === "LIVE" || v.status === "PREVIOUS") && v.gitTag)
    .sort((x, y) => x.number - y.number)
    .map((v) => v.gitTag);
}

/** Record the GitHub link; a failed write is logged, never thrown. */
async function recordGithub(
  ctx: MirrorContext,
  input: Parameters<typeof a.setGithub>[0],
): Promise<void> {
  try {
    await dispatchProduct(ctx, [a.setGithub(input)]);
  } catch (err) {
    ctx.log?.warn?.(`${TAG} the GitHub status couldn't be recorded: ${message(err)}`);
  }
}

/**
 * A token for the product's repository, or the reason there is none. A
 * repository that isn't (or no longer is) connected is not a failure: the
 * mirror is skipped, and a link that was connected is marked DISCONNECTED.
 */
async function tokenFor(
  ctx: MirrorContext,
  state: StudioProductState,
  appId: string,
): Promise<PushToken | MirrorResult> {
  try {
    return await mirrorDepsOf(ctx).pushToken(ctx, appId);
  } catch (err) {
    const notConnected =
      err instanceof LaunchError && (err.code === GITHUB_NOT_CONNECTED_CODE || isUnsupported(err));
    if (notConnected) {
      if (state.github.status !== "NOT_CONNECTED" && state.github.status !== "DISCONNECTED") {
        ctx.log?.warn?.(`${TAG} GitHub is disconnected; the code stays saved in the Studio`);
        await recordGithub(ctx, { status: "DISCONNECTED", repoFullName: null, lastError: null });
      } else {
        ctx.log?.debug?.(`${TAG} no GitHub repository: nothing to save there`);
      }
      return { skipped: MIRROR_REASONS.notConnected };
    }
    const reason = err instanceof LaunchError ? err.reason : MIRROR_REASONS.noToken;
    return { failed: reason === "Vetra didn't answer" ? reason : MIRROR_REASONS.noToken };
  }
}

/**
 * Push `main` and `tags` to the product's GitHub repository. Never throws:
 * `{ sha }` is what `main` is on GitHub now, `{ failed }` the plain reason
 * (recorded as PUSH_FAILED), `{ skipped }` when there is nothing to push to.
 */
export async function mirror(ctx: MirrorContext, opts: { tags: string[] }): Promise<MirrorResult> {
  const d = mirrorDepsOf(ctx);
  let state: StudioProductState | undefined;
  try {
    state = (await getProductDoc(ctx))?.state;
  } catch (err) {
    ctx.log?.warn?.(`${TAG} the product couldn't be read: ${message(err)}`);
    return { failed: MIRROR_REASONS.unreadable };
  }
  const appId = state?.appId;
  if (!state || !appId) return { skipped: MIRROR_REASONS.nothingLive };

  // Pre-check: git must read the repository; its own error is kept (not swallowed).
  let sha: string;
  try {
    sha = await d.git(ctx.workdir, ["rev-parse", "--verify", `refs/heads/${MAIN_BRANCH}^{commit}`], {
      reason: MIRROR_REASONS.unreadable,
    });
  } catch (err) {
    ctx.log?.error?.(`${TAG} ${message(err)}`);
    const reason = MIRROR_REASONS.unreadable;
    ctx.log?.warn?.(`${TAG} ${mirrorFailureText(reason)}`);
    return { failed: reason };
  }

  const token = await tokenFor(ctx, state, appId);
  if (!("token" in token)) {
    if ("failed" in token) {
      ctx.log?.warn?.(`${TAG} ${mirrorFailureText(token.failed)}`);
      const input = failedInput(state, null, token.failed);
      if (input) await recordGithub(ctx, input);
    }
    return token;
  }
  const repo = repoFullName(token.remoteUrl);

  const tags: string[] = [];
  for (const tag of [...new Set(opts.tags)]) {
    try {
      await d.git(ctx.workdir, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
      tags.push(tag);
    } catch {
      ctx.log?.debug?.(`${TAG} tag ${tag} isn't in the Studio; not pushed`);
    }
  }

  // F25b: recorded before the push, so the webhook knows our own commit.
  try {
    if (!(await d.recordMirror(ctx, appId, sha))) {
      ctx.log?.debug?.(`${TAG} the cloud doesn't record mirror pushes yet`);
    }
  } catch (err) {
    ctx.log?.warn?.(`${TAG} the push couldn't be announced; GitHub may show it as an outside change: ${message(err)}`);
  }

  // Atomic: the tags land only together with main (GitHub supports it).
  const refspecs = [
    `refs/heads/${MAIN_BRANCH}:refs/heads/${MAIN_BRANCH}`,
    ...tags.map((t) => `refs/tags/${t}:refs/tags/${t}`),
  ];
  try {
    await gitWithToken(ctx, ["push", "--atomic", token.remoteUrl, ...refspecs], token);
  } catch (err) {
    const reason = err instanceof LaunchError ? err.reason : MIRROR_REASONS.notAnswering;
    ctx.log?.warn?.(`${TAG} ${message(err)}`);
    ctx.log?.warn?.(`${TAG} ${mirrorFailureText(reason)}`);
    const input = failedInput(state, repo, reason);
    if (input) await recordGithub(ctx, input);
    return { failed: reason };
  }
  ctx.log?.info?.(`${TAG} saved to GitHub${repo ? ` (${repo})` : ""}: ${MAIN_BRANCH} ${sha.slice(0, 12)}${tags.length ? ` + ${tags.join(" ")}` : ""}`);
  await recordGithub(ctx, { status: "CONNECTED", repoFullName: repo, lastError: null });
  await clearIfBroughtIn(ctx, state, appId, sha);
  return { sha };
}

/** PUSH_FAILED needs a repository name; without one the failure is only logged. */
function failedInput(
  state: StudioProductState,
  repo: string | null,
  reason: string,
): Parameters<typeof a.setGithub>[0] | null {
  return repo || state.github.repoFullName
    ? { status: "PUSH_FAILED", repoFullName: repo, lastError: reason }
    : null;
}

/**
 * Once `main` on GitHub contains the changes made there (they were brought in
 * and launched), the flag is cleared in the cloud and in the product.
 */
async function clearIfBroughtIn(
  ctx: MirrorContext,
  state: StudioProductState,
  appId: string,
  sha: string,
): Promise<void> {
  const external = state.github.externalChangesSha;
  if (!external) return;
  const d = mirrorDepsOf(ctx);
  try {
    await d.git(ctx.workdir, ["merge-base", "--is-ancestor", external, sha]);
  } catch {
    return; // not (yet) part of what was pushed
  }
  try {
    if (!(await d.clearExternalChanges(ctx, appId))) {
      ctx.log?.debug?.(`${TAG} the cloud doesn't clear changes made on GitHub yet`);
    }
    await dispatchProduct(ctx, [a.setExternalChanges({ sha: null })]);
    ctx.log?.info?.(`${TAG} the changes made on GitHub are in the live version now`);
  } catch (err) {
    ctx.log?.warn?.(`${TAG} changes made on GitHub not cleared yet: ${message(err)}`);
  }
}

/**
 * On connect (and Retry now): push `main` and every launched version's tag,
 * so the repository has the product's whole history.
 */
export async function pushFullHistory(ctx: MirrorContext): Promise<MirrorResult> {
  let state: StudioProductState | undefined;
  try {
    state = (await getProductDoc(ctx))?.state;
  } catch (err) {
    ctx.log?.warn?.(`${TAG} the product couldn't be read: ${message(err)}`);
    return { failed: MIRROR_REASONS.unreadable };
  }
  return mirror(ctx, { tags: state ? launchedTags(state) : [] });
}

/** Whether the cloud knows `App.externalChangesSha` (false after it said no, for this process). */
let externalChangesSupported = true;

/** Tests only: forget that the cloud said no. */
export function resetExternalChangesSupport(): void {
  externalChangesSupported = true;
}

/**
 * F37: copy the cloud's `App.externalChangesSha` (set by the push webhook)
 * into the product with `SET_EXTERNAL_CHANGES`, while a repository is linked.
 * Returns what it did; never throws.
 */
export async function syncExternalChanges(
  ctx: MirrorContext,
  state: StudioProductState,
): Promise<"set" | "cleared" | null> {
  if (!externalChangesSupported) return null;
  if (state.github.status !== "CONNECTED" && state.github.status !== "PUSH_FAILED") return null;
  const studioEnvironmentId = ctx.config?.environmentId?.trim();
  if (!studioEnvironmentId || !state.appId) return null;
  try {
    const sha = await mirrorDepsOf(ctx).externalChanges(ctx, studioEnvironmentId);
    if (sha === undefined) {
      externalChangesSupported = false;
      ctx.log?.debug?.(`${TAG} the cloud doesn't report changes made on GitHub yet`);
      return null;
    }
    const next = sha?.toLowerCase() ?? null;
    if (next === state.github.externalChangesSha) return null;
    await dispatchProduct(ctx, [a.setExternalChanges({ sha: next })]);
    if (next) ctx.log?.info?.(`${TAG} there are changes on GitHub that aren't in the Studio (${next.slice(0, 12)})`);
    return next ? "set" : "cleared";
  } catch (err) {
    ctx.log?.warn?.(`${TAG} changes made on GitHub not checked: ${message(err)}`);
    return null;
  }
}
