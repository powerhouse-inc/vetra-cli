import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { startPreview } from "../../src/preview-server/starter.js";
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
  const start = jest.fn(
    args.startImpl ??
      (async () => {
        return "instance-1";
      }),
  );
  return { services: { list, start } as never, list, start };
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
});
