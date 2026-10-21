/**
 * Versions as git: the Studio workspace is a git repository on `main`, every
 * launched version is a commit tagged `v<n>` (spec §6.2, Ruling E5), and the
 * draft is the working tree.
 *
 * - `snapshot` commits the working tree as `Version <n>: <title>` and tags it.
 * - `restoreVersion` makes a new commit whose tree equals `v<m>` (Go back; no
 *   history rewrite, so a mirror stays fast-forward).
 * - `discardDraft` puts the reactor projects back to the live version.
 *
 * The agent runtime directory `.ph/` (keypair, Renown credential) is never
 * committed, at any depth, whatever the `.gitignore` says.
 */
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { listReactorProjects } from "../helpers/project.js";
import { ensureWorkspaceGitignore } from "../helpers/workspace-git.js";
import { LaunchError } from "./errors.js";

const execFileAsync = promisify(execFile);

export const MAIN_BRANCH = "main";

/** Who the version commits are by (the mirror later pushes them as-is). */
export interface GitAuthor {
  name: string;
  email: string;
}

export const DEFAULT_AUTHOR: GitAuthor = {
  name: "vetra-studio[bot]",
  email: "vetra-studio[bot]@users.noreply.github.com",
};

export function versionTag(n: number): string {
  return `v${n}`;
}

// Never sign or prompt: the Studio has no keys or terminal for either.
const BASE_CONFIG = [
  "-c",
  "commit.gpgsign=false",
  "-c",
  "tag.gpgsign=false",
  "-c",
  "core.quotepath=false",
];

function gitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extra };
}

function authorConfig(author: GitAuthor): string[] {
  return ["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`];
}

async function git(
  workdir: string,
  args: string[],
  opts: { env?: Record<string, string>; author?: GitAuthor } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [...BASE_CONFIG, ...(opts.author ? authorConfig(opts.author) : []), ...args],
      { cwd: workdir, env: gitEnv(opts.env), maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new LaunchError(
      "GIT_FAILED",
      "the code couldn't be saved",
      `git ${args[0]} failed: ${(e.stderr || e.message || "").trim()}`,
    );
  }
}

/** `git` that reports failure as null instead of throwing (probes). */
async function gitMaybe(workdir: string, args: string[]): Promise<string | null> {
  try {
    return await git(workdir, args);
  } catch {
    return null;
  }
}

async function headSha(workdir: string): Promise<string | null> {
  return gitMaybe(workdir, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]);
}

async function tagSha(workdir: string, tag: string): Promise<string | null> {
  return gitMaybe(workdir, ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
}

async function treeOf(workdir: string, rev: string): Promise<string> {
  return git(workdir, ["rev-parse", `${rev}^{tree}`]);
}

/**
 * Make the workspace a git repository on `main` with the workspace
 * `.gitignore` (F24). Idempotent. A repository made earlier by `git init`
 * (default branch `master`) is moved onto `main` when `main` doesn't exist yet;
 * a repository on some other branch while `main` exists is refused rather than
 * guessed at.
 */
export async function ensureWorkspaceRepo(workdir: string): Promise<void> {
  if (!fs.existsSync(path.join(workdir, ".git"))) {
    await git(workdir, ["init", "-q", "-b", MAIN_BRANCH]);
  }
  ensureWorkspaceGitignore(workdir);

  const current = await gitMaybe(workdir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (current === MAIN_BRANCH) return;
  const mainExists =
    (await gitMaybe(workdir, ["rev-parse", "-q", "--verify", `refs/heads/${MAIN_BRANCH}`])) !==
    null;
  if (current && !mainExists) {
    if (await headSha(workdir)) {
      await git(workdir, ["branch", "-m", current, MAIN_BRANCH]);
    } else {
      await git(workdir, ["symbolic-ref", "HEAD", `refs/heads/${MAIN_BRANCH}`]);
    }
    return;
  }
  throw new LaunchError(
    "NOT_ON_MAIN",
    "the code isn't on its main line",
    `Workspace repository is on ${current ? `branch "${current}"` : "a detached HEAD"}, not "${MAIN_BRANCH}".`,
  );
}

/** Stage the whole working tree except `.ph/` at any depth, and prove it. */
async function stageAll(workdir: string): Promise<void> {
  await git(workdir, ["add", "-A"]);
  await git(workdir, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ".ph", "*/.ph/*"]);
  const staged = await git(workdir, ["diff", "--cached", "--name-only"]);
  if (staged.split("\n").some((p) => /(^|\/)\.ph(\/|$)/.test(p))) {
    throw new LaunchError(
      "GIT_FAILED",
      "the code couldn't be saved",
      "Refusing to commit the agent runtime directory (.ph).",
    );
  }
}

/** True when staging the working tree would change nothing against HEAD. */
async function nothingToCommit(workdir: string): Promise<boolean> {
  return (await gitMaybe(workdir, ["diff", "--cached", "--quiet"])) !== null;
}

export interface SnapshotOptions {
  /**
   * Move an existing `v<n>` that points elsewhere (F23). The orchestrator
   * passes it only for a FAILED Version n that was never live or mirrored.
   */
  allowRetag?: boolean;
  author?: GitAuthor;
}

/**
 * Save the working tree as Version n: commit on `main` with message
 * `Version <n>: <title>` and tag `v<n>`. Idempotent: when `v<n>` already
 * points at HEAD and nothing changed since, it returns that commit.
 */
export async function snapshot(
  workdir: string,
  n: number,
  title: string,
  opts: SnapshotOptions = {},
): Promise<{ sha: string; tag: string }> {
  await ensureWorkspaceRepo(workdir);
  const tag = versionTag(n);
  const author = opts.author ?? DEFAULT_AUTHOR;

  try {
    await stageAll(workdir);
    const head = await headSha(workdir);
    const existing = await tagSha(workdir, tag);
    const clean = head !== null && (await nothingToCommit(workdir));

    if (existing && existing === head && clean) return { sha: head, tag };
    if (existing && !opts.allowRetag) {
      throw new LaunchError(
        "TAG_EXISTS",
        `Version ${n} already exists`,
        `Tag ${tag} already points at ${existing.slice(0, 12)}; refusing to move it.`,
      );
    }

    const message = `Version ${n}: ${title.trim() || "Untitled"}`;
    // A version is always its own commit, even when the code didn't change
    // since the last one (e.g. the first launch of an existing workspace).
    await git(workdir, ["commit", "-q", "--allow-empty", "--no-verify", "-m", message], {
      author,
    });
    const sha = (await headSha(workdir))!;
    await git(workdir, ["tag", "-f", tag, sha]);
    return { sha, tag };
  } catch (err) {
    await unstageAll(workdir);
    throw err;
  }
}

/** Put the index back to HEAD (nothing staged) after a failed snapshot. */
async function unstageAll(workdir: string): Promise<void> {
  if (await headSha(workdir)) await gitMaybe(workdir, ["reset", "-q"]);
  else await gitMaybe(workdir, ["read-tree", "--empty"]);
}

/** Non-ignored working-tree changes other than our own `.gitignore` entries. */
async function draftChanges(workdir: string): Promise<string[]> {
  const out = await git(workdir, ["status", "--porcelain", "--untracked-files=all"]);
  return out
    .split("\n")
    .filter(Boolean)
    // `git()` trims the output, so the first line may have lost its leading space.
    .map((line) => line.replace(/^\s*\S{1,2}\s+/, ""))
    .filter((p) => p !== ".gitignore");
}

/** Point `main` at a new commit with `tree` on top of HEAD (no history rewrite). */
async function commitTree(
  workdir: string,
  tree: string,
  message: string,
  author: GitAuthor,
): Promise<string> {
  const head = await headSha(workdir);
  const args = ["commit-tree", tree, "-m", message];
  if (head) args.push("-p", head);
  const sha = await git(workdir, args, {
    env: {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    },
  });
  await git(workdir, ["update-ref", `refs/heads/${MAIN_BRANCH}`, sha]);
  return sha;
}

/**
 * Go back to Version m (Ruling E5): a new commit on `main` whose tree equals
 * `v<m>`, message `Go back to Version <m>`, and the working tree follows it.
 * Newer versions stay reachable by their tags. Rollback is only offered while
 * no change is open (E6); any non-ignored change in the working tree is
 * refused with `DRAFT_OPEN` and nothing is touched. Ignored files (`.ph/`,
 * `node_modules/`) are never touched.
 */
export async function restoreVersion(
  workdir: string,
  m: number,
  opts: { author?: GitAuthor } = {},
): Promise<{ sha: string }> {
  await ensureWorkspaceRepo(workdir);
  const tag = versionTag(m);
  if (!(await tagSha(workdir, tag))) {
    throw new LaunchError(
      "GIT_FAILED",
      `Version ${m}'s code isn't in this Studio`,
      `Tag ${tag} not found.`,
    );
  }
  const draft = await draftChanges(workdir);
  if (draft.length > 0) {
    throw new LaunchError(
      "DRAFT_OPEN",
      "there are unsaved changes in your Studio",
      `Refusing to go back to ${tag} over ${draft.length} changed file(s): ${draft.slice(0, 5).join(", ")}`,
    );
  }
  const head = await headSha(workdir);
  const target = await treeOf(workdir, tag);
  if (head && (await treeOf(workdir, "HEAD")) === target) return { sha: head };
  const sha = await commitTree(
    workdir,
    target,
    `Go back to Version ${m}`,
    opts.author ?? DEFAULT_AUTHOR,
  );
  await git(workdir, ["reset", "-q", "--hard", sha]);
  // The restored tree may predate newer .gitignore entries; keep them.
  ensureWorkspaceGitignore(workdir);
  return { sha };
}

/** Reactor project dirs: those on disk plus those in `rev` (a draft may add or delete one).
 * With `onDisk: false`, only those in `rev`. */
export async function projectDirs(
  workdir: string,
  rev: string | null,
  opts: { onDisk?: boolean } = {},
): Promise<string[]> {
  const dirs = new Set(opts.onDisk === false ? [] : await listReactorProjects(workdir));
  if (rev) {
    const files = await git(workdir, ["ls-tree", "-r", "--name-only", rev]);
    for (const file of files.split("\n")) {
      const parts = file.split("/");
      if (parts.length === 2 && parts[1] === "powerhouse.config.json") dirs.add(parts[0]);
    }
  }
  return [...dirs].sort();
}

/**
 * Throw the draft away (F25): the reactor projects go back to the live
 * version `liveTag`; workspace-level files (product specs) and ignored files
 * (`.ph/` with the chats, `node_modules/`) are kept.
 *
 * When HEAD's project code differs from `liveTag` (a stray commit), a
 * `Discard change` commit is made whose project dirs equal `liveTag`'s; then
 * tracked files in the project dirs are reset to HEAD and untracked,
 * non-ignored files there are removed.
 */
export async function discardDraft(
  workdir: string,
  liveTag: string,
  opts: { author?: GitAuthor } = {},
): Promise<void> {
  await ensureWorkspaceRepo(workdir);
  if (!(await tagSha(workdir, liveTag))) {
    throw new LaunchError(
      "GIT_FAILED",
      "the live version's code isn't in this Studio",
      `Tag ${liveTag} not found.`,
    );
  }
  const head = await headSha(workdir);
  const dirs = await projectDirs(workdir, liveTag);
  if (head) for (const d of await projectDirs(workdir, "HEAD")) if (!dirs.includes(d)) dirs.push(d);
  if (dirs.length === 0) return;

  // Build "HEAD with the project dirs taken from liveTag" in a scratch index.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-discard-"));
  const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
  let tree: string;
  try {
    const run = (args: string[]) => git(workdir, args, { env });
    if (head) await run(["read-tree", "HEAD"]);
    else await run(["read-tree", "--empty"]);
    await run(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...dirs]);
    for (const dir of dirs) {
      if (await gitMaybe(workdir, ["rev-parse", "-q", "--verify", `${liveTag}:${dir}`])) {
        await run(["read-tree", `--prefix=${dir}/`, `${liveTag}:${dir}`]);
      }
    }
    tree = await run(["write-tree"]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (!head || (await treeOf(workdir, "HEAD")) !== tree) {
    await commitTree(workdir, tree, "Discard change", opts.author ?? DEFAULT_AUTHOR);
  }

  const tracked = new Set(
    (await git(workdir, ["ls-tree", "-d", "--name-only", "HEAD"])).split("\n").filter(Boolean),
  );
  await git(workdir, ["reset", "-q", "HEAD", "--", ...dirs]);
  const inHead = dirs.filter((d) => tracked.has(d));
  if (inHead.length > 0) await git(workdir, ["checkout", "-q", "HEAD", "--", ...inHead]);
  await git(workdir, ["clean", "-f", "-d", "-q", "--", ...dirs]);
}

/**
 * Whether the reactor projects on disk are exactly `tag`'s (tracked edits,
 * deletions and untracked, non-ignored files all count; workspace-level files
 * such as the product specs don't). False when the tag doesn't exist.
 */
export async function draftMatches(workdir: string, tag: string): Promise<boolean> {
  if (!fs.existsSync(path.join(workdir, ".git")) || !(await tagSha(workdir, tag))) return false;
  const dirs = await projectDirs(workdir, tag);
  if (dirs.length === 0) return true;
  // `git diff <tag>` compares the working tree with the tag for every path in
  // the tag or the index; untracked files are listed separately.
  const changed = await git(workdir, ["diff", "--name-only", tag, "--", ...dirs]);
  if (changed) return false;
  const untracked = await git(workdir, ["ls-files", "--others", "--exclude-standard", "--", ...dirs]);
  return untracked === "";
}

/**
 * Files that differ between the previous version's tag and `toSha` (for the
 * Versions panel's "what changed"). With no previous version, every file in
 * `toSha`.
 */
export function changedFiles(
  workdir: string,
  fromTag: string | null,
  toSha: string,
): string[] {
  const args = fromTag
    ? ["diff", "--name-only", fromTag, toSha, "--"]
    : ["ls-tree", "-r", "--name-only", toSha];
  const out = execFileSync("git", [...BASE_CONFIG, ...args], {
    cwd: workdir,
    env: gitEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\n").filter(Boolean);
}
