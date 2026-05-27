import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { resolvePreview } from "../../src/preview-server/resolver.js";
import { getPreviewDriveId } from "../../src/helpers/reactor-project-preview.js";
import { makeWorkdir } from "../spec/_fixtures.js";

interface FakeInstance {
  workdir: string;
  status: "starting" | "ready" | "stopped" | "failed";
  endpoints?: Record<string, string>;
  instanceId?: string;
}

function makeServices(instances: FakeInstance[]) {
  return { list: () => instances } as never;
}

describe("preview-server resolver", () => {
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

  it("returns no-target when project or doc is empty", async () => {
    const services = makeServices([]);
    expect(
      await resolvePreview({ services, workdir, project: "", doc: "x" }),
    ).toEqual({ kind: "no-target" });
    expect(
      await resolvePreview({ services, workdir, project: "x", doc: "" }),
    ).toEqual({ kind: "no-target" });
  });

  it("returns unknown-project when the sub-directory isn't a reactor package", async () => {
    const services = makeServices([]);
    const result = await resolvePreview({
      services,
      workdir,
      project: "not-a-project",
      doc: "doc-1",
    });
    expect(result.kind).toBe("unknown-project");
    const unknown = result as Extract<typeof result, { kind: "unknown-project" }>;
    expect(unknown.project).toBe("not-a-project");
    expect(unknown.error).toMatch(/not found|not a Reactor package/i);
  });

  it("returns project-stopped when no ServiceManager instance matches the projectPath", async () => {
    const services = makeServices([
      { workdir: "/some/other/path", status: "ready" },
    ]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result).toEqual({
      kind: "project-stopped",
      project: PROJECT,
      projectPath,
    });
  });

  it("returns project-stopped when the matching instance has stopped/failed", async () => {
    const services = makeServices([{ workdir: projectPath, status: "stopped" }]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result.kind).toBe("project-stopped");
  });

  it("returns starting when the matching instance is starting", async () => {
    const services = makeServices([
      { workdir: projectPath, status: "starting" },
    ]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result).toEqual({
      kind: "starting",
      project: PROJECT,
      projectPath,
      driveId: getPreviewDriveId(projectPath),
    });
  });

  it("returns starting when ready but Connect endpoint not yet captured", async () => {
    /* A reactor-project can flip to `ready` before the Connect endpoint has
     * been parsed from stdout — without it, we can't build a URL, so the
     * editor should keep showing the starting state. */
    const services = makeServices([
      { workdir: projectPath, status: "ready", endpoints: {} },
    ]);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result.kind).toBe("starting");
  });

  it("returns ready with a fully-formed URL when the instance is up", async () => {
    const services = makeServices([
      {
        workdir: projectPath,
        status: "ready",
        endpoints: { "vetra-studio": "http://localhost:3001" },
      },
    ]);
    const driveId = getPreviewDriveId(projectPath);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc-1",
    });
    expect(result).toEqual({
      kind: "ready",
      project: PROJECT,
      projectPath,
      driveId,
      documentId: "doc-1",
      url: `http://localhost:3001/d/${driveId}/doc-1?embed=1`,
    });
  });

  it("strips a trailing slash from the Connect endpoint and encodes the doc segment", async () => {
    const services = makeServices([
      {
        workdir: projectPath,
        status: "ready",
        endpoints: { "vetra-studio": "http://localhost:3001/" },
      },
    ]);
    const driveId = getPreviewDriveId(projectPath);
    const result = await resolvePreview({
      services,
      workdir,
      project: PROJECT,
      doc: "doc with spaces",
    });
    expect(result.kind).toBe("ready");
    const ready = result as Extract<typeof result, { kind: "ready" }>;
    expect(ready.url).toBe(
      `http://localhost:3001/d/${driveId}/doc%20with%20spaces?embed=1`,
    );
  });
});
