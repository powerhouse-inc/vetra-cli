import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LAUNCH_PUBLISH_FETCH_TIMEOUT_MS,
  productPackageName,
  publishAll,
  type PublishDeps,
} from "../../src/launch/publish-all.js";
import type { PackumentResult } from "../../src/cloud/registry-packument.js";

const REGISTRY = "https://registry.example.test";
let workdir: string;

function project(dir: string, version: string): string {
  const p = path.join(workdir, dir);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "powerhouse.config.json"), "{}\n");
  const pkg = `{\n  "name": "${dir}",\n  "version": "${version}"\n}\n`;
  fs.writeFileSync(path.join(p, "package.json"), pkg);
  return pkg;
}

type PublishFn = PublishDeps["publish"];
type PublishOpts = Parameters<PublishFn>[0];

function fakeDeps(packuments: Record<string, PackumentResult>) {
  const publish = jest.fn<PublishFn>(async (opts: PublishOpts) => {
    // The real publish rewrites package.json before building.
    fs.writeFileSync(
      path.join(opts.projectPath, "package.json"),
      JSON.stringify({ name: opts.packageName, version: opts.version }),
    );
    return { kind: "ok", packageName: opts.packageName!, version: opts.version!, registry: REGISTRY };
  });
  const deps: PublishDeps = {
    publish,
    fetchPackument: jest.fn(async (_r: string, name: string) => packuments[name] ?? { kind: "not-found" }),
    registryToken: async () => "registry-token",
  };
  return { deps, publish };
}

const ctx = { config: { registryUrl: REGISTRY } };

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-publish-all-"));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("productPackageName", () => {
  it("names the product @vetra-apps/<slug>, per project when there are several", () => {
    expect(productPackageName("team-todo", "todo", 1)).toBe("@vetra-apps/team-todo");
    expect(productPackageName("team-todo", "Billing_App", 2)).toBe("@vetra-apps/team-todo-billing_app");
  });
});

describe("publishAll", () => {
  it("publishAll publishes every project at a fresh version", async () => {
    const billingPkg = project("billing", "1.0.0");
    const todoPkg = project("todo", "0.1.0");
    fs.mkdirSync(path.join(workdir, "specs")); // not a reactor project
    const { deps, publish } = fakeDeps({
      "@vetra-apps/team-todo-billing": {
        kind: "ok",
        latest: "1.0.3",
        versions: { "1.0.0": {}, "1.0.3": {} },
      },
    });

    const out = await publishAll(ctx, workdir, { slug: "team-todo" }, deps);

    expect(out).toEqual([
      { name: "@vetra-apps/team-todo-billing", version: "1.0.4" },
      { name: "@vetra-apps/team-todo-todo", version: "0.1.0" },
    ]);
    expect(publish).toHaveBeenCalledTimes(2);
    for (const call of publish.mock.calls) {
      expect(call[0]).toMatchObject({
        bumpOnConflict: true,
        fetchTimeoutMs: LAUNCH_PUBLISH_FETCH_TIMEOUT_MS,
        registry: REGISTRY,
        workdir,
      });
    }
    // The snapshot's package.json is back as it was.
    expect(fs.readFileSync(path.join(workdir, "billing/package.json"), "utf8")).toBe(billingPkg);
    expect(fs.readFileSync(path.join(workdir, "todo/package.json"), "utf8")).toBe(todoPkg);
  });

  it("publishes a single project as @vetra-apps/<slug>", async () => {
    project("todo", "1.0.0");
    const { deps } = fakeDeps({
      "@vetra-apps/team-todo": { kind: "ok", latest: "1.0.0", versions: { "1.0.0": {} } },
    });
    expect(await publishAll(ctx, workdir, { slug: "team-todo" }, deps)).toEqual([
      { name: "@vetra-apps/team-todo", version: "1.0.1" },
    ]);
  });

  it("reports a missing publishing permission as PERMISSION and restores package.json", async () => {
    const pkg = project("todo", "1.0.0");
    const { deps, publish } = fakeDeps({});
    publish.mockImplementationOnce(async (opts: PublishOpts) => {
      fs.writeFileSync(path.join(opts.projectPath, "package.json"), "{}");
      return { kind: "auth-required", error: "not authorized" };
    });
    await expect(publishAll(ctx, workdir, { slug: "team-todo" }, deps)).rejects.toMatchObject({
      code: "PERMISSION",
    });
    expect(fs.readFileSync(path.join(workdir, "todo/package.json"), "utf8")).toBe(pkg);
  });

  it("stops at the first failed publish with a plain reason", async () => {
    project("a", "1.0.0");
    project("b", "1.0.0");
    const { deps, publish } = fakeDeps({});
    publish.mockImplementationOnce(async () => ({ kind: "failed", error: "Build failed" }));
    await expect(publishAll(ctx, workdir, { slug: "s" }, deps)).rejects.toMatchObject({
      code: "PUBLISH_FAILED",
      reason: "publishing didn't finish",
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("fails when the registry can't be read, and when there is no project", async () => {
    await expect(publishAll(ctx, workdir, { slug: "s" }, fakeDeps({}).deps)).rejects.toMatchObject({
      code: "NOTHING_TO_PUBLISH",
    });
    project("todo", "1.0.0");
    const { deps } = fakeDeps({ "@vetra-apps/s": { kind: "error", reason: "HTTP 502" } });
    await expect(publishAll(ctx, workdir, { slug: "s" }, deps)).rejects.toMatchObject({
      code: "PUBLISH_FAILED",
    });
  });
});
