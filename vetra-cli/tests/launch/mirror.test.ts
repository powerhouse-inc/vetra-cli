import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as studioProduct from "vetra-app/document-models/studio-product";
import { LaunchError } from "../../src/launch/errors.js";
import {
  MERGE_UNFINISHED_REASON,
  discardDraft,
  restoreVersion,
  snapshot,
  workspaceGit,
  type WorkspaceGitOptions,
} from "../../src/launch/git-versions.js";
import {
  MIRROR_REASONS,
  classify,
  mirror,
  mirrorFailureText,
  pushFullHistory,
  repoFullName,
  resetExternalChangesSupport,
  syncExternalChanges,
  type MirrorDeps,
} from "../../src/launch/mirror.js";
import { LAUNCH_TRIGGER, autoLaunchCandidate, launch } from "../../src/launch/orchestrator.js";
import {
  BRING_IN_REASONS,
  bringIn,
  bringInReminder,
  BRING_IN_REQUEST,
  GITHUB_MAIN_REF,
  isBringIn,
  mergeFailure,
  prepareChangeBase,
} from "../../src/product/changes.js";
import { dispatchProduct } from "../../src/product/product-doc.js";
import { productPushToken } from "../../src/helpers/github.js";
import { newRequestsMemory, requestsPass } from "../../src/triggers/product-requests.js";
import { AT, a, launchHarness, makeReady, type LaunchHarness } from "./orchestrator-helpers.js";

const BY = "did:pkh:eip155:1:0xowner";

// Real git against repositories on disk.
jest.setTimeout(30_000);

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** `refs → sha` of a repository (the "GitHub" side). */
function remoteRefs(bare: string): Record<string, string> {
  const out = git(bare, "for-each-ref", "--format=%(refname) %(objectname)");
  return Object.fromEntries(out.split("\n").filter(Boolean).map((l) => l.split(" ") as [string, string]));
}

interface GitCall {
  args: string[];
  env: Record<string, string> | undefined;
}

/** A "GitHub" repository on disk: `<root>/acme/team-todo.git` (bare). */
function fakeGithub(): { root: string; bare: string; url: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-gh-"));
  const bare = path.join(root, "acme", "team-todo.git");
  fs.mkdirSync(bare, { recursive: true });
  git(bare, "init", "-q", "--bare", "-b", "main");
  return { root, bare, url: `file://${bare}` };
}

/** Someone pushes a commit to `main` on GitHub; returns its sha. */
function pushOnGithub(bare: string, file: string, content: string): string {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clone-"));
  try {
    git(clone, "clone", "-q", bare, ".");
    write(clone, file, content);
    git(clone, "add", "-A", "-f");
    git(clone, "commit", "-q", "-m", "Edit on GitHub");
    git(clone, "push", "-q", "origin", "HEAD:refs/heads/main");
    return git(clone, "rev-parse", "HEAD");
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
}

interface Mirrored {
  h: LaunchHarness;
  gh: ReturnType<typeof fakeGithub>;
  token: string;
  gitCalls: GitCall[];
  recorded: { sha: string; remoteHadMain: boolean; liveVersion: number | null }[];
  cleared: string[];
  external: { sha: string | null | undefined };
}

/**
 * A Studio whose launches commit and tag for real, with a fake cloud that
 * hands out a generated token for a repository on disk.
 */
async function studio(opts: { connected?: boolean } = {}): Promise<Mirrored> {
  const gh = fakeGithub();
  const token = `ghs_${randomBytes(18).toString("hex")}`;
  const gitCalls: GitCall[] = [];
  const recorded: Mirrored["recorded"] = [];
  const cleared: string[] = [];
  const external: Mirrored["external"] = { sha: null };
  const h = await launchHarness({ snapshot, discardDraft, mirror });
  let connected = opts.connected ?? true;
  const deps: Partial<MirrorDeps> = {
    pushToken: async (_ctx, appId) => {
      expect(appId).toBe("app-1");
      if (!connected) throw new LaunchError("GITHUB_NOT_CONNECTED", "GitHub didn't let Vetra in", "studioPushToken: no repo");
      return { token, expiresAt: "2026-10-21T10:00:00.000Z", remoteUrl: gh.url };
    },
    recordMirror: async (_ctx, _appId, sha) => {
      recorded.push({
        sha,
        remoteHadMain: "refs/heads/main" in remoteRefs(gh.bare),
        liveVersion: (await h.state()).liveVersion ?? null,
      });
      return true;
    },
    clearExternalChanges: async (_ctx, appId) => {
      cleared.push(appId);
      return true;
    },
    externalChanges: async () => external.sha,
    git: (workdir: string, args: string[], o?: WorkspaceGitOptions) => {
      gitCalls.push({ args, env: o?.env });
      return workspaceGit(workdir, args, o);
    },
  };
  Object.assign(h.octx, { mirrorDeps: deps });
  write(h.workdir, "todo/powerhouse.config.json", "{}\n");
  write(h.workdir, "todo/src/model.ts", "export const v = 1;\n");
  const m: Mirrored = { h, gh, token, gitCalls, recorded, cleared, external };
  Object.defineProperty(m, "connect", { value: () => (connected = true) });
  return m;
}

/** No trace of the token anywhere but the one env value git reads it from. */
function expectTokenNowhere(m: Mirrored, extra: string[] = []): void {
  const basic = Buffer.from(`x-access-token:${m.token}`).toString("base64");
  for (const call of m.gitCalls) {
    expect(call.args.join(" ")).not.toContain(m.token);
    expect(call.args.join(" ")).not.toContain(basic);
    for (const [k, v] of Object.entries(call.env ?? {})) {
      if (k === "GIT_CONFIG_VALUE_0") expect(v).toBe(`AUTHORIZATION: basic ${basic}`);
      else expect(v).not.toContain(m.token);
    }
  }
  for (const text of [...m.h.lines, ...extra]) {
    expect(text).not.toContain(m.token);
    expect(text).not.toContain(basic);
  }
  const config = fs.readFileSync(path.join(m.h.workdir, ".git", "config"), "utf8");
  expect(config).not.toContain(m.token);
  expect(config).not.toContain(basic);
  expect(config).not.toContain("extraHeader");
}

/** The page's Bring them in, then the agent's first step of that change; returns the notes. */
async function bringInNow(m: Mirrored, id = "bring-1"): Promise<string[]> {
  await dispatchProduct(m.h.ctx, [
    a.startChange({ id, kind: "CHANGE", request: BRING_IN_REQUEST, startedAt: AT }),
  ]);
  const s = await m.h.state();
  const notes: string[] = [];
  await prepareChangeBase(m.h.octx, s.changes.find((c) => c.id === id)!, {
    state: s,
    note: (t) => notes.push(t),
  });
  return notes;
}

function mergeHead(root: string): string | null {
  try {
    return git(root, "rev-parse", "-q", "--verify", "MERGE_HEAD");
  } catch {
    return null;
  }
}

async function launchReady(m: Mirrored, changeId: string): Promise<void> {
  const out = await launch(m.h.octx, { changeId, trigger: LAUNCH_TRIGGER, launchedBy: BY });
  expect(out.status).toBe("LIVE");
}

/** A second change after launch, with an edit, made live. */
async function secondChange(m: Mirrored): Promise<void> {
  await dispatchProduct(m.h.ctx, [
    a.startChange({ id: "change-2", kind: "CHANGE", request: "Add a due date", startedAt: AT }),
  ]);
  write(m.h.workdir, "todo/src/model.ts", "export const v = 2;\n");
  await makeReady(m.h, "change-2");
  await launchReady(m, "change-2");
}

describe("GitHub mirror", () => {
  let m: Mirrored | undefined;
  afterEach(async () => {
    resetExternalChangesSupport();
    if (m) {
      await m.h.cleanup();
      fs.rmSync(m.gh.root, { recursive: true, force: true });
    }
    m = undefined;
  });

  it("every launch is a commit and tag on GitHub", async () => {
    m = await studio();
    await makeReady(m.h, "change-1", { title: "Team todo list" });
    await launchReady(m, "change-1");

    const s = await m.h.state();
    const v1 = s.versions[0];
    expect(v1.lines.find((l) => l.kind === "MIRROR")).toEqual({ kind: "MIRROR", status: "DONE", detail: v1.sha });
    expect(remoteRefs(m.gh.bare)).toEqual({ "refs/heads/main": v1.sha, "refs/tags/v1": v1.sha });
    expect(s.github).toEqual({
      status: "CONNECTED",
      repoFullName: "acme/team-todo",
      lastError: null,
      externalChangesSha: null,
    });
    // F25b: the commit was announced before GitHub had it — and after the
    // version was already live (MIRROR runs after COMPLETE_LAUNCH).
    expect(m.recorded).toEqual([{ sha: v1.sha, remoteHadMain: false, liveVersion: 1 }]);
    const push = m.gitCalls.find((c) => c.args[0] === "push")!;
    expect(push.env?.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraHeader");
    expectTokenNowhere(m, [JSON.stringify(s)]);
  });

  it("launch succeeds when the mirror push fails", async () => {
    m = await studio();
    // Someone pushed on GitHub first: the Studio's main isn't a fast-forward.
    pushOnGithub(m.gh.bare, "README.md", "edited on GitHub\n");
    await makeReady(m.h, "change-1", { title: "Team todo list" });

    const out = await launch(m.h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER });

    expect(out).toEqual({ status: "LIVE", number: 1 });
    const s = await m.h.state();
    expect(s.liveVersion).toBe(1);
    expect(s.versions[0].status).toBe("LIVE");
    expect(s.versions[0].lines.find((l) => l.kind === "MIRROR")).toEqual({
      kind: "MIRROR",
      status: "FAILED",
      detail: MIRROR_REASONS.diverged,
    });
    expect(s.github).toMatchObject({
      status: "PUSH_FAILED",
      repoFullName: "acme/team-todo",
      lastError: MIRROR_REASONS.diverged,
    });
    expect(m.h.lines).toContain(
      "[mirror] Couldn't save to GitHub (there are changes on GitHub that aren't in your Studio). Will retry with the next launch.",
    );
    expect(remoteRefs(m.gh.bare)["refs/tags/v1"]).toBeUndefined();
    expectTokenNowhere(m, [JSON.stringify(s)]);
  });

  it("workflow files GitHub won't take from Vetra fail the mirror, not the launch", async () => {
    m = await studio();
    // GitHub's answer to an App token without the workflows permission.
    const hook = path.join(m.gh.bare, "hooks", "pre-receive");
    fs.writeFileSync(
      hook,
      "#!/bin/sh\necho \"refusing to allow a GitHub App to create or update workflow \\\`.github/workflows/ci.yml\\\` without \\\`workflows\\\` permission\" >&2\nexit 1\n",
      { mode: 0o755 },
    );
    write(m.h.workdir, ".github/workflows/ci.yml", "on: push\n");
    await makeReady(m.h, "change-1");
    expect(await launch(m.h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER })).toEqual({
      status: "LIVE",
      number: 1,
    });
    const s = await m.h.state();
    expect(s.versions[0].lines.find((l) => l.kind === "MIRROR")).toEqual({
      kind: "MIRROR",
      status: "FAILED",
      detail: MIRROR_REASONS.workflows,
    });
    expect(s.github).toMatchObject({ status: "PUSH_FAILED", lastError: MIRROR_REASONS.workflows });
    expect(m.h.lines).toContain(
      "[mirror] Couldn't save to GitHub (your code has GitHub workflow files, which Vetra can't save to GitHub). Will retry with the next launch.",
    );
  });

  it("a mirror that can't even get a token doesn't stop the launch either", async () => {
    m = await studio();
    Object.assign(m.h.octx, {
      mirrorDeps: {
        ...(m.h.octx as { mirrorDeps: Partial<MirrorDeps> }).mirrorDeps,
        pushToken: async () => {
          throw new LaunchError("CLOUD_UNAVAILABLE", "Vetra didn't answer", "studioPushToken: HTTP 502");
        },
      },
    });
    await makeReady(m.h, "change-1");
    expect(await launch(m.h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER })).toEqual({
      status: "LIVE",
      number: 1,
    });
    const s = await m.h.state();
    expect(s.versions[0].lines.find((l) => l.kind === "MIRROR")?.status).toBe("FAILED");
    // Nothing was ever linked: there is no repository to mark as failing.
    expect(s.github.status).toBe("NOT_CONNECTED");
    expect(m.h.lines).toContain("[mirror] Couldn't save to GitHub (Vetra didn't answer). Will retry with the next launch.");
  });

  it("without GitHub the mirror line is skipped and nothing is written", async () => {
    m = await studio({ connected: false });
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    const s = await m.h.state();
    expect(s.versions[0].lines.find((l) => l.kind === "MIRROR")).toEqual({
      kind: "MIRROR",
      status: "SKIPPED",
      detail: null,
    });
    expect(s.github.status).toBe("NOT_CONNECTED");
    expect(m.recorded).toEqual([]);
  });

  it("connect pushes every version tag", async () => {
    m = await studio({ connected: false });
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    await dispatchProduct(m.h.ctx, [
      a.startChange({ id: "change-2", kind: "CHANGE", request: "add due dates", startedAt: AT }),
    ]);
    write(m.h.workdir, "todo/src/model.ts", "export const v = 2;\n");
    await makeReady(m.h, "change-2");
    await launchReady(m, "change-2");
    expect(remoteRefs(m.gh.bare)).toEqual({});

    // The customer connects GitHub; the page asks the agent to save there.
    (m as unknown as { connect(): void }).connect();
    await dispatchProduct(m.h.ctx, [a.requestMirror({ requestedAt: AT, requestedBy: BY })]);
    expect(await requestsPass(m.h.octx, newRequestsMemory())).toBe("mirror");

    const s = await m.h.state();
    const [v1, v2] = s.versions;
    expect(remoteRefs(m.gh.bare)).toEqual({
      "refs/heads/main": v2.sha,
      "refs/tags/v1": v1.sha,
      "refs/tags/v2": v2.sha,
    });
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toBeNull();
    expect(s.github.status).toBe("CONNECTED");
    expect(m.recorded).toEqual([{ sha: v2.sha, remoteHadMain: false, liveVersion: 2 }]);
    expectTokenNowhere(m, [JSON.stringify(s)]);

    // Again: nothing new, still fine.
    expect(await pushFullHistory(m.h.octx)).toEqual({ sha: v2.sha });
  });

  it("Retry now without GitHub records why and clears the request", async () => {
    m = await studio({ connected: false });
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    await dispatchProduct(m.h.ctx, [a.requestMirror({ requestedAt: AT, requestedBy: BY })]);
    expect(await requestsPass(m.h.octx, newRequestsMemory())).toBe("mirror");
    const s = await m.h.state();
    expect(s.pendingRequest).toBeNull();
    expect(s.lastRequestFailure).toEqual({ kind: "MIRROR", reason: MIRROR_REASONS.notConnected, at: AT });
  });

  it("a revoked connection shows as disconnected; the code stays in the Studio", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    (m.h.octx as { mirrorDeps: Partial<MirrorDeps> }).mirrorDeps.pushToken = async () => {
      throw new LaunchError("GITHUB_NOT_CONNECTED", "GitHub didn't let Vetra in", "studioPushToken: disconnected");
    };
    expect(await pushFullHistory(m.h.octx)).toEqual({ skipped: MIRROR_REASONS.notConnected });
    expect((await m.h.state()).github).toMatchObject({ status: "DISCONNECTED", repoFullName: "acme/team-todo" });
  });

  it("a disconnected product with an earlier Studio connection isn't pushed with the old one", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    const before = remoteRefs(m.gh.bare);
    const mm = m;
    let legacyAsked = 0;
    (m.h.octx as { mirrorDeps: Partial<MirrorDeps> }).mirrorDeps.pushToken = (ctx, appId) =>
      productPushToken(ctx, appId, {
        studio: async () => {
          const err = new LaunchError("GITHUB_NOT_CONNECTED", "GitHub didn't let Vetra in", "studioPushToken: disconnected");
          err.cloudReason = "DISCONNECTED";
          throw err;
        },
        legacy: async () => {
          legacyAsked++;
          return { token: mm.token, expiresAt: "2026-10-21T10:00:00.000Z", remoteUrl: mm.gh.url };
        },
      });
    await secondChange(m);
    const s = await m.h.state();
    expect(s.versions.find((v) => v.number === 2)!.lines.find((l) => l.kind === "MIRROR")).toMatchObject({
      status: "SKIPPED",
    });
    expect(s.github).toMatchObject({ status: "DISCONNECTED" });
    expect(legacyAsked).toBe(0);
    expect(remoteRefs(m.gh.bare)).toEqual(before);
    expect(m.gitCalls.filter((c) => c.args[0] === "push")).toHaveLength(1);
  });

  it("a flagged commit that vanished from GitHub is cleared by the next successful mirror", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    const v1 = (await m.h.state()).versions[0].sha;
    const theirs = pushOnGithub(m.gh.bare, "todo/src/extra.ts", "export const x = 1;\n");
    m.external.sha = theirs;
    expect(await syncExternalChanges(m.h.octx, await m.h.state())).toBe("set");
    // Someone resets GitHub's main back to the Studio's version: the flagged commit is gone.
    git(m.gh.bare, "update-ref", "refs/heads/main", v1);
    await secondChange(m);
    const s = await m.h.state();
    expect(s.github).toMatchObject({ status: "CONNECTED", externalChangesSha: null });
    expect(m.cleared).toEqual(["app-1"]);
  });

  it("an unreadable workspace fails the mirror with git's own error, not silently", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    fs.rmSync(path.join(m.h.workdir, ".git"), { recursive: true, force: true });
    expect(await mirror(m.h.octx, { tags: ["v1"] })).toEqual({ failed: MIRROR_REASONS.unreadable });
    expect(m.h.lines.some((l) => l.startsWith("[mirror] git rev-parse failed:"))).toBe(true);
  });

  it("bring in creates a change and launches nothing", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    const theirs = pushOnGithub(m.gh.bare, "todo/src/extra.ts", "export const fromGithub = true;\n");

    // The push webhook flagged it on the App; the Studio copies it (F37).
    m.external.sha = theirs;
    let s = await m.h.state();
    expect(await syncExternalChanges(m.h.octx, s)).toBe("set");
    s = await m.h.state();
    expect(s.github.externalChangesSha).toBe(theirs);
    expect(await syncExternalChanges(m.h.octx, s)).toBeNull();

    // Bring them in: the page starts a change with its own conversation.
    await dispatchProduct(m.h.ctx, [
      a.startChange({
        id: "bring-1",
        kind: "CHANGE",
        request: BRING_IN_REQUEST,
        chatSessionId: "chat-bring-1",
        startedAt: AT,
      }),
    ]);
    s = await m.h.state();
    const change = s.changes.find((c) => c.id === "bring-1")!;
    const notes: string[] = [];
    await prepareChangeBase(m.h.octx, change, { state: s, note: (t) => notes.push(t) });

    expect(git(m.h.workdir, "rev-parse", GITHUB_MAIN_REF)).toBe(theirs);
    expect(fs.readFileSync(path.join(m.h.workdir, "todo/src/extra.ts"), "utf8")).toContain("fromGithub");
    expect(git(m.h.workdir, "rev-parse", "MERGE_HEAD")).toBe(theirs);
    // Shared history: merged as it is, never as unrelated.
    expect(m.gitCalls.filter((c) => c.args[0] === "merge").flatMap((c) => c.args)).not.toContain(
      "--allow-unrelated-histories",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(theirs.slice(0, 12));
    expect(notes[0]).toContain("merged into this change");

    // Nothing launches by itself — not now, and not once the change is ready.
    expect(await requestsPass(m.h.octx, newRequestsMemory())).toBeNull();
    await makeReady(m.h, "bring-1");
    expect(await requestsPass(m.h.octx, newRequestsMemory())).toBeNull();
    s = await m.h.state();
    expect(s.versions).toHaveLength(1);
    expect(s.changes.find((c) => c.id === "bring-1")?.status).toBe("READY");
    expect(autoLaunchCandidate({ ...s, liveVersion: null, versions: [] })).toBeNull();

    // Make it live: the version is a merge of GitHub's main, so the mirror is a fast-forward.
    await launchReady(m, "bring-1");
    s = await m.h.state();
    const v2 = s.versions.find((v) => v.number === 2)!;
    expect(git(m.h.workdir, "rev-list", "--parents", "-n", "1", v2.sha).split(" ")).toContain(theirs);
    expect(remoteRefs(m.gh.bare)["refs/heads/main"]).toBe(v2.sha);
    expect(s.github.externalChangesSha).toBeNull();
    expect(m.cleared).toEqual(["app-1"]);
    expectTokenNowhere(m, [JSON.stringify(s), ...notes]);
  });

  it("a repository the Studio carried over with its own history shows as changes on GitHub and is never forced", async () => {
    m = await studio();
    // The Studio's earlier repository: its history isn't the Studio's.
    const theirs = pushOnGithub(m.gh.bare, "README.md", "pushed before the move\n");
    await makeReady(m.h, "change-1");
    const out = await launch(m.h.octx, { changeId: "change-1", trigger: LAUNCH_TRIGGER, launchedBy: BY });
    expect(out.status).toBe("LIVE");

    let s = await m.h.state();
    expect(s.versions[0].lines.find((l) => l.kind === "MIRROR")).toMatchObject({
      status: "FAILED",
      detail: MIRROR_REASONS.diverged,
    });
    // The customer sees "There are changes on GitHub…" with Bring them in.
    expect(s.github).toEqual({
      status: "PUSH_FAILED",
      repoFullName: "acme/team-todo",
      lastError: MIRROR_REASONS.diverged,
      externalChangesSha: theirs,
    });
    // Nothing forced: GitHub's main is untouched.
    expect(remoteRefs(m.gh.bare)["refs/heads/main"]).toBe(theirs);
    expect(m.gitCalls.some((c) => c.args.includes("--force") || c.args.some((x) => x.startsWith("+refs/heads/main:refs/heads")))).toBe(false);

    // The cloud never saw that push (it predates the move): its "none" doesn't hide it.
    m.external.sha = null;
    expect(await syncExternalChanges(m.h.octx, s)).toBeNull();
    expect((await m.h.state()).github.externalChangesSha).toBe(theirs);

    // Bring them in joins the two histories.
    const notes = await bringInNow(m);
    expect(notes[0]).toContain("merged into this change");
    expect(mergeHead(m.h.workdir)).toBe(theirs);
    const merge = m.gitCalls.find((c) => c.args[0] === "merge" && c.args.includes(GITHUB_MAIN_REF))!;
    expect(merge.args).toContain("--allow-unrelated-histories");
    expect(fs.readFileSync(path.join(m.h.workdir, "README.md"), "utf8")).toContain("pushed before the move");

    await makeReady(m.h, "bring-1");
    await launchReady(m, "bring-1");
    s = await m.h.state();
    const v2 = s.versions.find((v) => v.number === 2)!;
    expect(remoteRefs(m.gh.bare)["refs/heads/main"]).toBe(v2.sha);
    expect(git(m.h.workdir, "merge-base", "--is-ancestor", theirs, v2.sha)).toBe("");
    expect(s.github).toMatchObject({ status: "CONNECTED", externalChangesSha: null });
    expectTokenNowhere(m, [JSON.stringify(s), ...notes]);
  });

  it("bring in with conflicting edits leaves them for the agent to resolve", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    pushOnGithub(m.gh.bare, "todo/src/model.ts", "export const v = 'github';\n");
    // Meanwhile the Studio launched its own edit of the same line (the mirror was refused).
    await dispatchProduct(m.h.ctx, [
      a.startChange({ id: "change-2", kind: "CHANGE", request: "count to two", startedAt: AT }),
    ]);
    write(m.h.workdir, "todo/src/model.ts", "export const v = 2;\n");
    await makeReady(m.h, "change-2");
    await launchReady(m, "change-2");
    expect((await m.h.state()).github.status).toBe("PUSH_FAILED");

    await dispatchProduct(m.h.ctx, [
      a.startChange({ id: "bring-1", kind: "CHANGE", request: BRING_IN_REQUEST, startedAt: AT }),
    ]);
    const s = await m.h.state();
    const notes: string[] = [];
    await prepareChangeBase(m.h.octx, s.changes.find((c) => c.id === "bring-1")!, {
      state: s,
      note: (t) => notes.push(t),
    });
    expect(notes[0]).toContain("todo/src/model.ts");
    expect(notes[0]).toContain("conflict");
  });

  it("a failed snapshot keeps the merge; the retried version still has GitHub's commit as a parent", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    const theirs = pushOnGithub(m.gh.bare, "todo/src/extra.ts", "export const x = 1;\n");
    await bringInNow(m);
    expect(mergeHead(m.h.workdir)).toBe(theirs);
    // Force a failure after staging: v2 already exists elsewhere.
    git(m.h.workdir, "tag", "v2", "v1");
    await expect(snapshot(m.h.workdir, 2, "bring in")).rejects.toMatchObject({ code: "TAG_EXISTS" });
    expect(mergeHead(m.h.workdir)).toBe(theirs);
    git(m.h.workdir, "tag", "-d", "v2");
    const { sha } = await snapshot(m.h.workdir, 2, "bring in");
    expect(git(m.h.workdir, "rev-list", "--parents", "-n", "1", sha).split(" ")).toHaveLength(3);
    expect(git(m.h.workdir, "rev-list", "--parents", "-n", "1", sha)).toContain(theirs);
  });

  it("a version refuses an unfinished merge, then saves the resolved one", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    pushOnGithub(m.gh.bare, "todo/src/model.ts", "export const v = 'github';\n");
    await dispatchProduct(m.h.ctx, [
      a.startChange({ id: "change-2", kind: "CHANGE", request: "count to two", startedAt: AT }),
    ]);
    write(m.h.workdir, "todo/src/model.ts", "export const v = 2;\n");
    await makeReady(m.h, "change-2");
    await launchReady(m, "change-2");
    await bringInNow(m);

    // Still unmerged.
    await expect(snapshot(m.h.workdir, 3, "bring in")).rejects.toMatchObject({
      code: "MERGE_UNFINISHED",
      reason: MERGE_UNFINISHED_REASON,
    });
    // Staged, but the markers are still in the file.
    git(m.h.workdir, "add", "todo/src/model.ts");
    await expect(snapshot(m.h.workdir, 3, "bring in")).rejects.toMatchObject({ code: "MERGE_UNFINISHED" });
    // Resolved.
    write(m.h.workdir, "todo/src/model.ts", "export const v = 'both';\n");
    git(m.h.workdir, "add", "todo/src/model.ts");
    const { sha } = await snapshot(m.h.workdir, 3, "bring in");
    expect(git(m.h.workdir, "rev-list", "--parents", "-n", "1", sha).split(" ")).toHaveLength(3);
  });

  it("discarding a bring-in puts GitHub's files outside the projects back too; Go back works", async () => {
    m = await studio();
    write(m.h.workdir, "specs/product/idea.md", "# Idea\n");
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    pushOnGithub(m.gh.bare, "README.md", "# From GitHub\n");
    await bringInNow(m);
    expect(fs.existsSync(path.join(m.h.workdir, "README.md"))).toBe(true);
    // The customer's own spec edit, which the merge didn't touch.
    write(m.h.workdir, "specs/product/idea.md", "# Idea, edited\n");

    const kept = await discardDraft(m.h.workdir, "v1", { label: "bring-1" });

    expect(mergeHead(m.h.workdir)).toBeNull();
    expect(fs.existsSync(path.join(m.h.workdir, "README.md"))).toBe(false);
    expect(git(m.h.workdir, "show", `${kept}:README.md`)).toBe("# From GitHub");
    expect(fs.readFileSync(path.join(m.h.workdir, "specs/product/idea.md"), "utf8")).toBe("# Idea, edited\n");
    // Nothing GitHub brought is left staged: only the spec edit is a draft.
    expect(git(m.h.workdir, "status", "--porcelain")).toBe("M specs/product/idea.md");
    write(m.h.workdir, "specs/product/idea.md", "# Idea\n");
    await expect(restoreVersion(m.h.workdir, 1)).resolves.toBeDefined();
  });

  it("discarding a bring-in that brought an ignored file (.env.example) still succeeds", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    pushOnGithub(m.gh.bare, ".env.example", "API_URL=\n");
    await bringInNow(m);
    expect(fs.existsSync(path.join(m.h.workdir, ".env.example"))).toBe(true);

    const kept = await discardDraft(m.h.workdir, "v1", { label: "bring-1" });

    expect(git(m.h.workdir, "show", `${kept}:.env.example`)).toBe("API_URL=");
    expect(mergeHead(m.h.workdir)).toBeNull();
    expect(fs.existsSync(path.join(m.h.workdir, ".env.example"))).toBe(false);
    expect(git(m.h.workdir, "status", "--porcelain")).toBe("");
    await expect(restoreVersion(m.h.workdir, 1)).resolves.toBeDefined();
  });

  it("a discard that fails half-way keeps the merge, and trying again finishes it", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    const theirs = pushOnGithub(m.gh.bare, "README.md", "# From GitHub\n");
    await bringInNow(m);
    // The unsaved ref can't be written: the discard stops before resetting anything.
    const refsDir = path.join(m.h.workdir, ".git", "refs", "vetra", "unsaved");
    fs.mkdirSync(refsDir, { recursive: true });
    fs.chmodSync(refsDir, 0o555);
    try {
      await expect(discardDraft(m.h.workdir, "v1", { label: "bring-1" })).rejects.toMatchObject({
        code: "GIT_FAILED",
      });
    } finally {
      fs.chmodSync(refsDir, 0o755);
    }
    expect(mergeHead(m.h.workdir)).toBe(theirs);

    const kept = await discardDraft(m.h.workdir, "v1", { label: "bring-1" });
    expect(git(m.h.workdir, "show", `${kept}:README.md`)).toBe("# From GitHub");
    expect(mergeHead(m.h.workdir)).toBeNull();
    expect(git(m.h.workdir, "status", "--porcelain")).toBe("");
  });

  it("a merge already in place is not merged again; open conflicts are told on later turns", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    pushOnGithub(m.gh.bare, "todo/src/model.ts", "export const v = 'github';\n");
    await dispatchProduct(m.h.ctx, [
      a.startChange({ id: "change-2", kind: "CHANGE", request: "count to two", startedAt: AT }),
    ]);
    write(m.h.workdir, "todo/src/model.ts", "export const v = 2;\n");
    await makeReady(m.h, "change-2");
    await launchReady(m, "change-2");
    await bringInNow(m);
    const s = await m.h.state();
    const change = s.changes.find((c) => c.id === "bring-1")!;

    // Prepared again with the merge left in place.
    const again = await bringIn(m.h.octx, s);
    expect(again).toContain("conflict with the Studio's code: todo/src/model.ts");
    // A later turn: the base is marked, so prepareChangeBase only reminds.
    const notes: string[] = [];
    expect(await prepareChangeBase(m.h.octx, change, { state: s, note: (t) => notes.push(t) })).toBe("already");
    expect(notes[0]).toContain("todo/src/model.ts");
    expect(await bringInReminder(m.h.octx, change)).toContain("todo/src/model.ts");

    // Resolved and staged: no reminder; a clean merge already in place says so.
    write(m.h.workdir, "todo/src/model.ts", "export const v = 'both';\n");
    git(m.h.workdir, "add", "todo/src/model.ts");
    expect(await bringInReminder(m.h.octx, change)).toBeNull();
    expect(await bringIn(m.h.octx, s)).toContain("already merged into this change's files");
    // Not a bring-in change: never reminded.
    expect(await bringInReminder(m.h.octx, { ...change, request: "something else" })).toBeNull();
  });

  it("bring in refuses code on GitHub that has a .ph folder", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    pushOnGithub(m.gh.bare, "todo/.ph/keys.json", "{}\n");
    const notes = await bringInNow(m);
    expect(notes[0]).toContain(BRING_IN_REASONS.runtimeDir);
    expect(mergeHead(m.h.workdir)).toBeNull();
    expect(fs.existsSync(path.join(m.h.workdir, "todo/.ph/keys.json"))).toBe(false);
  });

  it("bring in without a token tells the agent it couldn't fetch", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    (m.h.octx as { mirrorDeps: Partial<MirrorDeps> }).mirrorDeps.pushToken = async () => {
      throw new LaunchError("GITHUB_NOT_CONNECTED", "GitHub didn't let Vetra in", "studioPushToken: disconnected");
    };
    await dispatchProduct(m.h.ctx, [
      a.startChange({ id: "bring-1", kind: "CHANGE", request: BRING_IN_REQUEST, startedAt: AT }),
    ]);
    const s = await m.h.state();
    const notes: string[] = [];
    const out = await prepareChangeBase(m.h.octx, s.changes.find((c) => c.id === "bring-1")!, {
      state: s,
      note: (t) => notes.push(t),
    });
    expect(out).toBe("unchanged");
    expect(notes[0]).toContain("couldn't be fetched");
  });

  it("a repository carried over with the Studio's own history isn't taken for changes made on GitHub", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    const s = await m.h.state();
    // The cloud recorded GitHub's main when it carried the repository over: the Studio's own commit.
    m.external.sha = s.versions[0].sha;
    expect(await syncExternalChanges(m.h.octx, s)).toBeNull();
    expect((await m.h.state()).github.externalChangesSha).toBeNull();
    expect(m.cleared).toEqual(["app-1"]);
  });

  it("a cloud that doesn't report changes on GitHub yet is left alone", async () => {
    m = await studio();
    await makeReady(m.h, "change-1");
    await launchReady(m, "change-1");
    m.external.sha = undefined;
    expect(await syncExternalChanges(m.h.octx, await m.h.state())).toBeNull();
    m.external.sha = "a".repeat(40);
    // Not asked again in this process.
    expect(await syncExternalChanges(m.h.octx, await m.h.state())).toBeNull();
    expect(m.h.lines.some((l) => l.includes("doesn't report changes made on GitHub yet"))).toBe(true);
  });
});

describe("mirror words", () => {
  it("the bring-in request is the page's own text", () => {
    expect(BRING_IN_REQUEST).toBe(studioProduct.BRING_IN_REQUEST);
    expect(isBringIn({ kind: "CHANGE", request: BRING_IN_REQUEST })).toBe(true);
    expect(isBringIn({ kind: "UNDO", request: BRING_IN_REQUEST })).toBe(false);
  });

  it("workflow files GitHub won't take from Vetra are told in plain words", () => {
    expect(
      classify(
        " ! [remote rejected] main -> main (refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission)",
      ),
    ).toBe(MIRROR_REASONS.workflows);
  });

  it("failure line copy is exact", () => {
    expect(mirrorFailureText("GitHub didn't answer.")).toBe(
      "Couldn't save to GitHub (GitHub didn't answer). Will retry with the next launch.",
    );
  });

  it("merge refusals in plain words", () => {
    expect(mergeFailure("error: Your local changes to the following files would be overwritten by merge:")).toBe(
      BRING_IN_REASONS.overwrite,
    );
    expect(mergeFailure("error: The following untracked working tree files would be overwritten by merge:")).toBe(
      BRING_IN_REASONS.overwrite,
    );
    expect(mergeFailure("fatal: refusing to merge unrelated histories")).toBe(BRING_IN_REASONS.unrelated);
    expect(mergeFailure("fatal: something else")).toBe(BRING_IN_REASONS.other);
  });

  it("repository names and git refusals", () => {
    expect(repoFullName("https://github.com/web3-berlin/kitchen.git")).toBe("web3-berlin/kitchen");
    expect(repoFullName("kitchen")).toBeNull();
    expect(classify(" ! [rejected]        main -> main (fetch first)")).toBe(MIRROR_REASONS.diverged);
    expect(classify(" ! [rejected]        v2 -> v2 (already exists)")).toBe(MIRROR_REASONS.tagMoved);
    expect(classify("remote: Permission to acme/x.git denied to bot.\nfatal: ... 403")).toBe(MIRROR_REASONS.refused);
    expect(classify("fatal: unable to access: Could not resolve host")).toBe(MIRROR_REASONS.notAnswering);
    // --atomic: the moved tag is the cause; main only failed with it.
    expect(
      classify(
        [
          "error: atomic push failed for ref refs/tags/v1. status: 3",
          "To https://github.com/acme/team-todo.git",
          " ! [rejected]        main -> main (atomic push failed)",
          " ! [rejected]        v1 -> v1 (already exists)",
          "error: failed to push some refs to 'https://github.com/acme/team-todo.git'",
        ].join("\n"),
      ),
    ).toBe(MIRROR_REASONS.tagMoved);
    expect(
      classify(
        [
          " ! [rejected]        main -> main (fetch first)",
          " ! [rejected]        v2 -> v2 (atomic push failed)",
        ].join("\n"),
      ),
    ).toBe(MIRROR_REASONS.diverged);
    expect(classify(" ! [rejected]        main -> main (non-fast-forward)")).toBe(MIRROR_REASONS.diverged);
    // A protected branch (or any hook) declining the push.
    expect(
      classify(
        [
          "remote: error: GH006: Protected branch update failed for refs/heads/main.",
          " ! [remote rejected] main -> main (protected branch hook declined)",
        ].join("\n"),
      ),
    ).toBe(MIRROR_REASONS.refused);
    expect(classify(" ! [rejected]        main -> main (atomic push failed)")).toBe(MIRROR_REASONS.notAnswering);
  });
});
