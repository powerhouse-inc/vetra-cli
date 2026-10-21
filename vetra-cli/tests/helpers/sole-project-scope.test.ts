/**
 * The one-project default (resolveReactorProjectPath) is for the agent's spec
 * and reactor-project-start commands only. Starting, restarting and
 * publishing from the preview server or the publish commands name their
 * project: an empty one is refused, never resolved to the only project.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reactorProjectPublish } from "../../src/commands/reactor-project/publish.js";
import { reactorProjectPublishStatus } from "../../src/commands/reactor-project/publish-status.js";
import { resolveReactorProjectPath, soleReactorProject } from "../../src/helpers/project.js";
import { publishProjectForDeploy } from "../../src/preview-server/publish-project.js";
import { readProjectPackage } from "../../src/preview-server/package-info.js";
import { restartPreview, startPreview } from "../../src/preview-server/starter.js";

describe("one-project default scope", () => {
  let workdir: string;
  let project: string;
  beforeEach(() => {
    // A Studio workspace: the root isn't a package, one project under it.
    workdir = mkdtempSync(join(tmpdir(), "vetra-sole-"));
    project = join(workdir, "todo-list");
    mkdirSync(project);
    writeFileSync(join(project, "powerhouse.config.json"), "{}");
    writeFileSync(join(project, "package.json"), '{"name":"todo-list","version":"1.0.0"}');
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  it("applies by default and can be turned off", async () => {
    await expect(resolveReactorProjectPath(workdir, undefined)).resolves.toBe(project);
    await expect(
      resolveReactorProjectPath(workdir, undefined, { soleProjectDefault: false }),
    ).rejects.toThrow(/Workdir is not a Reactor package/);
    await expect(
      resolveReactorProjectPath(workdir, "todo-list", { soleProjectDefault: false }),
    ).resolves.toBe(project);
  });

  it("skips hand-written stub projects (not installed) when picking the default", async () => {
    // The real project is installed; a stub beside it has only a config.
    mkdirSync(join(project, "node_modules"));
    const stub = join(workdir, "stub");
    mkdirSync(stub);
    writeFileSync(join(stub, "powerhouse.config.json"), "{}");
    await expect(resolveReactorProjectPath(workdir, undefined)).resolves.toBe(project);
    await expect(soleReactorProject(workdir)).resolves.toBe(project);

    // Two installed projects: no default.
    mkdirSync(join(stub, "node_modules"));
    await expect(soleReactorProject(workdir)).resolves.toBeNull();
    await expect(resolveReactorProjectPath(workdir, undefined)).rejects.toThrow(
      /Workdir is not a Reactor package/,
    );
  });

  it("the preview server's /start and /restart refuse an empty project", async () => {
    const start = jest.fn(() => Promise.resolve("i1"));
    const stop = jest.fn(() => Promise.resolve());
    const services = { list: () => [], start, stop } as never;
    await expect(startPreview({ services, workdir, project: "" })).resolves.toMatchObject({
      kind: "unknown-project",
      project: "",
    });
    await expect(restartPreview({ services, workdir, project: "" })).resolves.toMatchObject({
      kind: "unknown-project",
    });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("the preview server's /publish refuses an empty project", async () => {
    await expect(
      publishProjectForDeploy({ workdir, project: "", renownUrl: "https://renown.invalid" }),
    ).resolves.toMatchObject({ kind: "unknown-project", project: "" });
  });

  it("package-info refuses an empty project", async () => {
    await expect(readProjectPackage(workdir, "")).resolves.toMatchObject({
      kind: "unknown-project",
    });
    await expect(readProjectPackage(workdir, "todo-list")).resolves.toMatchObject({
      kind: "ok",
      name: "todo-list",
    });
  });

  it("reactor-project-publish and -publish-status refuse an empty project", async () => {
    const ctx = { workdir, config: {}, stdout: () => {} } as never;
    await expect(
      reactorProjectPublish.execute({ dryRun: true }, ctx),
    ).rejects.toThrow(/Workdir is not a Reactor package/);
    await expect(
      reactorProjectPublishStatus.execute({}, ctx),
    ).rejects.toThrow(/Workdir is not a Reactor package/);
  });
});
