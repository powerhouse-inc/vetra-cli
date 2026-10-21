/**
 * reactor-project-start reports the project it started, so the Studio's
 * preview pane can show that project as soon as it is up — also when the
 * agent left `workdir` out (the workspace's only project).
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reactorProjectStart } from "../../src/commands/reactor-project/start.js";

type Instance = { instanceId: string; workdir: string; status: string; serviceId: string };

function fakeServices(instances: Instance[]) {
  return {
    list: () => instances,
    start: (_id: string, opts: { workdir: string }) => {
      const instance = { instanceId: "i1", workdir: opts.workdir, status: "starting", serviceId: "reactor-project" };
      instances.push(instance);
      return Promise.resolve(instance.instanceId);
    },
  };
}

describe("reactor-project-start", () => {
  let workdir: string;
  let project: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "vetra-start-"));
    project = join(workdir, "todo-list");
    mkdirSync(project);
    writeFileSync(join(project, "powerhouse.config.json"), "{}");
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  const run = (input: Record<string, unknown>, services: ReturnType<typeof fakeServices>) =>
    reactorProjectStart.execute(input, {
      workdir,
      services,
      stdout: () => {},
      config: {},
    } as never) as Promise<{ text: string; data?: { project: string; projectPath: string } }>;

  it("starts the only project when no workdir is named, and says which", async () => {
    const instances: Instance[] = [];
    const result = await run({}, fakeServices(instances));
    expect(instances.map((i) => i.workdir)).toEqual([project]);
    expect(result.data).toEqual({ project: "todo-list", projectPath: project });
  });

  it("reports the project of an instance already running", async () => {
    const instances: Instance[] = [
      { instanceId: "i0", workdir: project, status: "ready", serviceId: "reactor-project" },
    ];
    const result = await run({ workdir: "todo-list" }, fakeServices(instances));
    expect(instances).toHaveLength(1);
    expect(result.data).toEqual({ project: "todo-list", projectPath: project });
  });
});
