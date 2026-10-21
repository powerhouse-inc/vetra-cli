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

const { publishReactorProject } = await import(
  "../../src/commands/reactor-project/publish-core.js"
);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vetra-publish-core-"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"todo","version":"1.0.0"}');
  npmPublish.mockClear();
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
});
