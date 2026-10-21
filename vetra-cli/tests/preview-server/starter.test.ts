import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { restartPreview, startPreview } from "../../src/preview-server/starter.js";
import { getPreviewDriveId } from "../../src/helpers/reactor-project-preview.js";
import { makeWorkdir } from "../spec/_fixtures.js";

interface FakeInstance {
  workdir: string;
  status: "starting" | "ready" | "stopped" | "failed";
  instanceId?: string;
}

function makeServices(args: {
  initial?: FakeInstance[];
  startImpl?: (id: string, opts: { workdir: string }) => Promise<string>;
}) {
  const list = jest.fn(() => args.initial ?? []);
  const stop = jest.fn<(id: string, instanceId?: string) => Promise<void>>(
    async () => {},
  );
  const start = jest.fn(
    args.startImpl ??
      (async () => {
        return "instance-1";
      }),
  );
  return { services: { list, start, stop } as never, list, start, stop };
}

describe("preview-server starter", () => {
  let workdir: string;
  let cleanup: () => void;
  let projectPath: string;
  const PROJECT = "demo-project";

  beforeEach(() => {
    ({ workdir, cleanup } = makeWorkdir());
    projectPath = join(workdir, PROJECT);
    mkdirSync(projectPath);
    writeFileSync(join(projectPath, "powerhouse.config.json"), "{}\n");
  });
  afterEach(() => cleanup());

  it("returns unknown-project for a non-reactor sub-directory and does NOT call services.start", async () => {
    const { services, start } = makeServices({});
    const result = await startPreview({
      services,
      workdir,
      project: "not-a-project",
    });
    expect(result.kind).toBe("unknown-project");
    expect(start).not.toHaveBeenCalled();
  });

  it("returns already-running without starting when an instance is ready", async () => {
    const { services, start } = makeServices({
      initial: [{ workdir: projectPath, status: "ready", instanceId: "i-1" }],
    });
    const result = await startPreview({
      services,
      workdir,
      project: PROJECT,
    });
    expect(start).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "already-running",
      project: PROJECT,
      projectPath,
      instanceId: "i-1",
      driveId: getPreviewDriveId(projectPath),
      status: "ready",
    });
  });

  it("returns already-running without starting when an instance is starting", async () => {
    const { services, start } = makeServices({
      initial: [{ workdir: projectPath, status: "starting", instanceId: "i-2" }],
    });
    const result = await startPreview({
      services,
      workdir,
      project: PROJECT,
    });
    expect(start).not.toHaveBeenCalled();
    expect(result.kind).toBe("already-running");
  });

  it("calls services.start when no live instance exists and returns the new instanceId", async () => {
    const { services, start } = makeServices({
      initial: [],
      startImpl: async () => "new-instance",
    });
    const result = await startPreview({
      services,
      workdir,
      project: PROJECT,
    });
    expect(start).toHaveBeenCalledTimes(1);
    const args = start.mock.calls[0] as unknown as [string, { workdir: string; cwd: string }];
    expect(args[0]).toBe("reactor-project");
    expect(args[1].workdir).toBe(projectPath);
    expect(args[1].cwd).toBe(projectPath);
    expect(result).toEqual({
      kind: "started",
      project: PROJECT,
      projectPath,
      instanceId: "new-instance",
      driveId: getPreviewDriveId(projectPath),
    });
  });

  it("returns failed when services.start throws (e.g. port conflict)", async () => {
    const { services } = makeServices({
      initial: [],
      startImpl: async () => {
        throw new Error("port 3000 in use");
      },
    });
    const result = await startPreview({
      services,
      workdir,
      project: PROJECT,
    });
    expect(result).toEqual({
      kind: "failed",
      project: PROJECT,
      error: "port 3000 in use",
    });
  });

  it("ignores stopped/failed instances when deciding to start", async () => {
    /* A previous instance that crashed shouldn't block a fresh start. */
    const { services, start } = makeServices({
      initial: [{ workdir: projectPath, status: "failed", instanceId: "old" }],
      startImpl: async () => "new",
    });
    const result = await startPreview({
      services,
      workdir,
      project: PROJECT,
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("started");
  });

  it("restart stops an instance stuck starting and starts a fresh one", async () => {
    const { services, start, stop } = makeServices({
      initial: [
        { workdir: projectPath, status: "starting", instanceId: "stuck" },
        { workdir: projectPath, status: "failed", instanceId: "old" },
        { workdir: join(workdir, "other"), status: "ready", instanceId: "x" },
      ],
      startImpl: async () => "fresh",
    });
    const result = await restartPreview({ services, workdir, project: PROJECT });
    expect(stop.mock.calls).toEqual([["reactor-project", "stuck"]]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      kind: "started",
      project: PROJECT,
      projectPath,
      instanceId: "fresh",
      driveId: getPreviewDriveId(projectPath),
    });
  });

  it("restart reports unknown projects and stop failures without starting", async () => {
    const unknown = makeServices({});
    expect(
      (await restartPreview({ services: unknown.services, workdir, project: "nope" })).kind,
    ).toBe("unknown-project");
    expect(unknown.stop).not.toHaveBeenCalled();

    const broken = makeServices({
      initial: [{ workdir: projectPath, status: "ready", instanceId: "i-1" }],
    });
    broken.stop.mockImplementation(async () => {
      throw new Error("cannot stop");
    });
    const result = await restartPreview({ services: broken.services, workdir, project: PROJECT });
    expect(result).toEqual({ kind: "failed", project: PROJECT, error: "cannot stop" });
    expect(broken.start).not.toHaveBeenCalled();
  });

  it("overlapping restarts of a project share one restart", async () => {
    let release: (id: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { services, start, stop } = makeServices({
      initial: [{ workdir: projectPath, status: "ready", instanceId: "i-1" }],
      startImpl: () => gate,
    });
    const first = restartPreview({ services, workdir, project: PROJECT });
    const second = restartPreview({ services, workdir, project: PROJECT });
    release("fresh");
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.kind).toBe("started");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);

    // Once done, a later restart runs again.
    await restartPreview({ services, workdir, project: PROJECT });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("restart only stops running instances and tolerates one already gone", async () => {
    const instances: FakeInstance[] = [
      { workdir: projectPath, status: "ready", instanceId: "i-1" },
      { workdir: projectPath, status: "stopping", instanceId: "i-2" },
    ];
    const { services, start, stop } = makeServices({
      initial: instances,
      startImpl: async () => "fresh",
    });
    stop.mockImplementation(async () => {
      // It stopped on its own meanwhile; the manager says it isn't running.
      instances[0].status = "stopped";
      throw new Error("not running");
    });
    const result = await restartPreview({ services, workdir, project: PROJECT });
    expect(stop.mock.calls).toEqual([["reactor-project", "i-1"]]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("started");
  });
});
