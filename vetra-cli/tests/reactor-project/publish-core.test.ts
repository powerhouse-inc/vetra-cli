import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type NpmPublish = (opts: { args?: string[]; cwd: string }) => Promise<{ stdout: string }>;
const npmPublish = jest.fn<NpmPublish>(async () => ({ stdout: "" }));
jest.unstable_mockModule("@powerhousedao/shared/registry", () => ({ npmPublish }));
jest.unstable_mockModule("../../src/auth/renown.js", () => ({
  getRegistryToken: async () => "registry-token",
}));
type RunBuild = (projectPath: string) => Promise<{ success: boolean; output: string }>;
const runBuild = jest.fn<RunBuild>(async () => ({ success: true, output: "" }));
jest.unstable_mockModule("../../src/commands/reactor-project/build.js", () => ({ runBuild }));

const { publishReactorProject } = await import(
  "../../src/commands/reactor-project/publish-core.js"
);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-publish-core-"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"todo","version":"1.0.0"}');
  npmPublish.mockClear();
  runBuild.mockClear();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("publishReactorProject", () => {
  it("publishes under another name with a long fetch timeout and no npm retries", async () => {
    const result = await publishReactorProject({
      projectPath: dir,
      workdir: dir,
      renownUrl: "https://renown.example.test",
      registry: "https://registry.example.test",
      packageName: "@vetra-apps/team-todo",
      version: "1.0.4",
      contentHash: "hash",
      skipBuild: true,
      fetchTimeoutMs: 1_800_000,
    });
    expect(result).toMatchObject({ kind: "ok", packageName: "@vetra-apps/team-todo", version: "1.0.4" });
    expect(npmPublish.mock.calls[0][0].args).toEqual(["--fetch-timeout=1800000", "--fetch-retries=0"]);
    const written = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    expect(written).toMatchObject({ name: "@vetra-apps/team-todo", version: "1.0.4" });
  });

  it("keeps npm's defaults when no timeout is given", async () => {
    await publishReactorProject({
      projectPath: dir,
      workdir: dir,
      renownUrl: "https://renown.example.test",
      registry: "https://registry.example.test",
      contentHash: "hash",
      skipBuild: true,
    });
    expect(npmPublish.mock.calls[0][0].args).toEqual([]);
  });

  describe("powerhouse.manifest.json", () => {
    const manifestPath = () => path.join(dir, "powerhouse.manifest.json");
    const readManifest = () => JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
    const base = {
      projectPath: "",
      workdir: "",
      renownUrl: "https://renown.example.test",
      registry: "https://registry.example.test",
      contentHash: "hash",
    };

    it("builds and publishes with the manifest carrying the overriding package name", async () => {
      fs.writeFileSync(
        manifestPath(),
        JSON.stringify({ name: "todo-list", apps: [{ id: "todo-app" }], documentModels: [] }),
      );
      const seen: { pkg?: string; manifest?: string } = {};
      runBuild.mockImplementationOnce(async () => {
        seen.pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name;
        seen.manifest = readManifest().name;
        return { success: true, output: "" };
      });
      const result = await publishReactorProject({
        ...base,
        projectPath: dir,
        workdir: dir,
        packageName: "@vetra-apps/tack",
        version: "1.0.0",
      });
      expect(result).toMatchObject({ kind: "ok", packageName: "@vetra-apps/tack" });
      expect(seen).toEqual({ pkg: "@vetra-apps/tack", manifest: "@vetra-apps/tack" });
      // Every other field is kept.
      expect(readManifest()).toEqual({
        name: "@vetra-apps/tack",
        apps: [{ id: "todo-app" }],
        documentModels: [],
      });
    });

    it("leaves the manifest alone without a name override or on a dry run", async () => {
      const original = '{"name":"todo-list","apps":[]}';
      fs.writeFileSync(manifestPath(), original);
      await publishReactorProject({ ...base, projectPath: dir, workdir: dir, skipBuild: true });
      expect(fs.readFileSync(manifestPath(), "utf8")).toBe(original);
      await publishReactorProject({
        ...base,
        projectPath: dir,
        workdir: dir,
        packageName: "@vetra-apps/tack",
        skipBuild: true,
        dryRun: true,
      });
      expect(fs.readFileSync(manifestPath(), "utf8")).toBe(original);
    });

    it("does not create a manifest for a project without one", async () => {
      await publishReactorProject({
        ...base,
        projectPath: dir,
        workdir: dir,
        packageName: "@vetra-apps/tack",
        skipBuild: true,
      });
      expect(fs.existsSync(manifestPath())).toBe(false);
    });
  });
});
