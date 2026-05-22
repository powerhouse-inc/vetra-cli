import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveReactorProjectPath } from "../../src/helpers/project.js";

function mkProject(parent: string, name: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "powerhouse.config.json"), "{}", "utf8");
  return dir;
}

describe("resolveReactorProjectPath", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "vetra-project-"));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("returns the subdir when it is a Reactor package", async () => {
    mkProject(workdir, "workout-tracker");
    await expect(
      resolveReactorProjectPath(workdir, "workout-tracker"),
    ).resolves.toBe(join(workdir, "workout-tracker"));
  });

  it("returns the workdir when it is itself a Reactor package", async () => {
    writeFileSync(join(workdir, "powerhouse.config.json"), "{}", "utf8");
    await expect(resolveReactorProjectPath(workdir, undefined)).resolves.toBe(
      workdir,
    );
  });

  it("lists available projects when workdir is not a Reactor package", async () => {
    mkProject(workdir, "alpha");
    mkProject(workdir, "beta");
    await expect(
      resolveReactorProjectPath(workdir, undefined),
    ).rejects.toThrow(/Available projects: alpha, beta/);
  });

  it("suggests the closest project name on a typo", async () => {
    mkProject(workdir, "workout-tracker");
    await expect(
      resolveReactorProjectPath(workdir, "worktout-tracker"),
    ).rejects.toThrow(/Did you mean: workout-tracker\?/);
  });

  it("flags an existing-but-non-Reactor subdir", async () => {
    mkdirSync(join(workdir, "src"));
    await expect(resolveReactorProjectPath(workdir, "src")).rejects.toThrow(
      /"src" is not a Reactor package/,
    );
  });

  it("ignores dotfiles when listing projects", async () => {
    mkProject(workdir, "alpha");
    mkdirSync(join(workdir, ".cache"));
    writeFileSync(
      join(workdir, ".cache", "powerhouse.config.json"),
      "{}",
      "utf8",
    );
    await expect(
      resolveReactorProjectPath(workdir, undefined),
    ).rejects.toThrow(/Available projects: alpha$/m);
  });
});
