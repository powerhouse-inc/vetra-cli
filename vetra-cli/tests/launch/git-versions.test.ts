import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  changedFiles,
  discardDraft,
  ensureWorkspaceRepo,
  restoreVersion,
  snapshot,
} from "../../src/launch/git-versions.js";
import { LaunchError } from "../../src/launch/errors.js";

let workdir: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: workdir, encoding: "utf8" }).trim();
}

function write(rel: string, content: string): void {
  const file = path.join(workdir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(rel: string): string | null {
  const file = path.join(workdir, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/** A workspace with one reactor project, workspace specs and agent runtime files. */
function seedWorkspace(): void {
  write("todo/powerhouse.config.json", "{}\n");
  write("todo/package.json", '{"name":"todo","version":"1.0.0"}\n');
  write("todo/src/model.ts", "export const v = 1;\n");
  write("specs/product/idea.md", "# Idea\n");
  write(".ph/vetra/.mastra/chat.db", "chat history");
  write("todo/.ph/key.json", "agent key");
}

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-git-versions-"));
  seedWorkspace();
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("ensureWorkspaceRepo", () => {
  it("initialises a repository on main with the workspace .gitignore", async () => {
    await ensureWorkspaceRepo(workdir);
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(read(".gitignore")).toContain(".ph/");
    expect(read(".gitignore")).toContain(".env*");
    expect(read(".gitignore")).toContain(".npmrc");
  });

  it("moves a repository created on another default branch onto main", async () => {
    execFileSync("git", ["init", "-q", "-b", "master"], { cwd: workdir });
    await ensureWorkspaceRepo(workdir);
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("main");
  });
});

describe("snapshot", () => {
  it("snapshot tags v1 and is idempotent", async () => {
    const first = await snapshot(workdir, 1, "A todo app");
    expect(first.tag).toBe("v1");
    expect(git("rev-parse", "v1^{commit}")).toBe(first.sha);
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git("log", "-1", "--format=%s")).toBe("Version 1: A todo app");

    const again = await snapshot(workdir, 1, "A todo app");
    expect(again).toEqual(first);
    expect(git("rev-list", "--count", "HEAD")).toBe("1");
  });

  it("never commits the agent runtime directory", async () => {
    // Even with a .gitignore that doesn't list it.
    await snapshot(workdir, 1, "First");
    const files = git("ls-tree", "-r", "--name-only", "HEAD").split("\n");
    expect(files).toEqual(expect.arrayContaining(["todo/src/model.ts", "specs/product/idea.md"]));
    expect(files.filter((f) => f.includes(".ph/"))).toEqual([]);
  });

  it("refuses to move an existing tag unless allowed (F23)", async () => {
    await snapshot(workdir, 1, "First");
    write("todo/src/model.ts", "export const v = 2;\n");
    await expect(snapshot(workdir, 1, "First")).rejects.toMatchObject({ code: "TAG_EXISTS" });
    // The refused snapshot leaves nothing staged.
    expect(git("diff", "--cached", "--name-only")).toBe("");

    const retried = await snapshot(workdir, 1, "First", { allowRetag: true });
    expect(git("rev-parse", "v1^{commit}")).toBe(retried.sha);
    expect(git("show", "v1:todo/src/model.ts")).toBe("export const v = 2;");
  });

  it("makes a commit per version even when nothing changed", async () => {
    const v1 = await snapshot(workdir, 1, "First");
    const v2 = await snapshot(workdir, 2, "Second");
    expect(v2.sha).not.toBe(v1.sha);
    expect(changedFiles(workdir, "v1", v2.sha)).toEqual([]);
  });
});

describe("restoreVersion", () => {
  it("restoreVersion makes main's tree equal v1 and keeps v2 reachable", async () => {
    await snapshot(workdir, 1, "First");
    write("todo/src/model.ts", "export const v = 2;\n");
    write("todo/src/extra.ts", "export const extra = true;\n");
    const v2 = await snapshot(workdir, 2, "Second");

    const { sha } = await restoreVersion(workdir, 1);
    expect(git("rev-parse", "HEAD")).toBe(sha);
    expect(git("rev-parse", "HEAD^{tree}")).toBe(git("rev-parse", "v1^{tree}"));
    expect(git("log", "-1", "--format=%s")).toBe("Go back to Version 1");
    // No history rewrite: v2 is an ancestor of the new main and still tagged.
    expect(git("rev-parse", "HEAD~1")).toBe(v2.sha);
    expect(git("rev-parse", "v2^{commit}")).toBe(v2.sha);
    // The working tree follows; ignored runtime files stay.
    expect(read("todo/src/model.ts")).toBe("export const v = 1;\n");
    expect(read("todo/src/extra.ts")).toBeNull();
    expect(read(".ph/vetra/.mastra/chat.db")).toBe("chat history");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("refuses to go back over unsaved changes and changes nothing", async () => {
    await snapshot(workdir, 1, "First");
    write("todo/src/model.ts", "export const v = 2;\n");
    const v2 = await snapshot(workdir, 2, "Second");
    write("todo/src/model.ts", "export const v = 3;\n");
    write("todo/src/new.ts", "new\n");

    await expect(restoreVersion(workdir, 1)).rejects.toMatchObject({ code: "DRAFT_OPEN" });
    expect(git("rev-parse", "HEAD")).toBe(v2.sha);
    expect(read("todo/src/model.ts")).toBe("export const v = 3;\n");
    expect(read("todo/src/new.ts")).toBe("new\n");
  });

  it("does not count ignored files or new .gitignore entries as unsaved changes", async () => {
    await snapshot(workdir, 1, "First");
    await snapshot(workdir, 2, "Second");
    write(".env.local", "TOKEN=x\n");
    fs.appendFileSync(path.join(workdir, ".gitignore"), "dist/\n");
    await expect(restoreVersion(workdir, 1)).resolves.toBeDefined();
  });

  it("does nothing when main already has that version's code", async () => {
    const v1 = await snapshot(workdir, 1, "First");
    expect(await restoreVersion(workdir, 1)).toEqual({ sha: v1.sha });
  });

  it("fails plainly for an unknown version", async () => {
    await snapshot(workdir, 1, "First");
    await expect(restoreVersion(workdir, 7)).rejects.toBeInstanceOf(LaunchError);
  });
});

describe("discardDraft", () => {
  it("discardDraft keeps the workspace specs and chats", async () => {
    await snapshot(workdir, 1, "First");
    // A draft: edited, deleted and new files in the project; specs edited too.
    write("todo/src/model.ts", "export const v = 99;\n");
    fs.rmSync(path.join(workdir, "todo/package.json"));
    write("todo/src/draft.ts", "export const draft = 1;\n");
    write("specs/product/idea.md", "# Idea, refined\n");
    write(".ph/vetra/.mastra/chat.db", "chat history + more");

    const kept = await discardDraft(workdir, "v1", { label: "c 1", now: () => 42 });

    // Snapshotted first, without moving main.
    expect(kept).toBe("refs/vetra/unsaved/c_1-42");
    expect(git("show", `${kept}:todo/src/draft.ts`)).toBe("export const draft = 1;");
    expect(git("show", `${kept}:todo/src/model.ts`)).toBe("export const v = 99;");
    expect(git("ls-tree", "-r", "--name-only", kept!)).not.toMatch(/\.ph\//);
    expect(read("todo/src/model.ts")).toBe("export const v = 1;\n");
    expect(read("todo/package.json")).toBe('{"name":"todo","version":"1.0.0"}\n');
    expect(read("todo/src/draft.ts")).toBeNull();
    expect(read("specs/product/idea.md")).toBe("# Idea, refined\n");
    expect(read(".ph/vetra/.mastra/chat.db")).toBe("chat history + more");
    expect(read("todo/.ph/key.json")).toBe("agent key");
    expect(git("rev-list", "--count", "HEAD")).toBe("1");
  });

  it("commits 'Discard change' when HEAD moved past the live version (F25)", async () => {
    await snapshot(workdir, 1, "First");
    write("todo/src/model.ts", "export const v = 2;\n");
    write("todo/src/stray.ts", "export const stray = 1;\n");
    write("specs/product/idea.md", "# Idea v2\n");
    git("add", "-A", "--", "todo", "specs");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "stray");

    await discardDraft(workdir, "v1");

    expect(git("log", "-1", "--format=%s")).toBe("Discard change");
    expect(git("show", "HEAD:todo/src/model.ts")).toBe("export const v = 1;");
    expect(git("ls-tree", "-r", "--name-only", "HEAD", "--", "todo/src")).toBe("todo/src/model.ts");
    // Workspace-level files keep HEAD's content.
    expect(git("show", "HEAD:specs/product/idea.md")).toBe("# Idea v2");
    expect(read("todo/src/stray.ts")).toBeNull();
    expect(git("status", "--porcelain")).toBe("");
  });

  it("keeps nothing when the code already is the live version's", async () => {
    await snapshot(workdir, 1, "First");
    expect(await discardDraft(workdir, "v1")).toBeNull();
    expect(git("for-each-ref", "refs/vetra/")).toBe("");
  });

  it("removes a reactor project the draft added", async () => {
    await snapshot(workdir, 1, "First");
    write("second/powerhouse.config.json", "{}\n");
    write("second/src/a.ts", "x\n");
    await discardDraft(workdir, "v1");
    expect(fs.existsSync(path.join(workdir, "second/src/a.ts"))).toBe(false);
  });
});

describe("changedFiles", () => {
  it("lists the files changed since the previous version, or all for the first", async () => {
    const v1 = await snapshot(workdir, 1, "First");
    expect(changedFiles(workdir, null, v1.sha)).toEqual(
      expect.arrayContaining(["todo/src/model.ts", "specs/product/idea.md", ".gitignore"]),
    );
    write("todo/src/model.ts", "export const v = 2;\n");
    const v2 = await snapshot(workdir, 2, "Second");
    expect(changedFiles(workdir, "v1", v2.sha)).toEqual(["todo/src/model.ts"]);
  });
});
