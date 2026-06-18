import { describe, expect, it } from "@jest/globals";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deployEnvironmentCreate } from "../../src/commands/deploy/create.js";
import { deployEnvironmentGet } from "../../src/commands/deploy/get.js";
import { deployEnvironmentList } from "../../src/commands/deploy/list.js";
import { deployEnvironmentUpdate } from "../../src/commands/deploy/update.js";

// All four commands hit the real cloud path: a throwaway workdir builds an
// unauthenticated Renown identity, so reads short-circuit (null token) and
// writes refuse (no signed-in user) before any network call.
function cloudCtx() {
  const workdir = mkdtempSync(join(tmpdir(), "vetra-deploy-test-"));
  return { workdir, config: {} } as never;
}

describe("deploy-environment command shapes", () => {
  it("exposes the expected ids and input fields", () => {
    expect(deployEnvironmentList.id).toBe("deploy-environment-list");
    expect(deployEnvironmentList.inputSchema.shape).toHaveProperty("scope");
    expect(deployEnvironmentList.inputSchema.shape).toHaveProperty("status");

    expect(deployEnvironmentGet.id).toBe("deploy-environment-get");
    expect(deployEnvironmentGet.inputSchema.shape).toHaveProperty("name");
    expect(deployEnvironmentGet.inputSchema.shape).toHaveProperty("full");
    expect(deployEnvironmentGet.inputSchema.shape).toHaveProperty("filter");

    expect(deployEnvironmentCreate.id).toBe("deploy-environment-create");
    expect(deployEnvironmentCreate.inputSchema.shape).toHaveProperty("name");
    expect(deployEnvironmentCreate.inputSchema.shape).toHaveProperty("services");

    expect(deployEnvironmentUpdate.id).toBe("deploy-environment-update");
    expect(deployEnvironmentUpdate.inputSchema.shape).toHaveProperty("label");
    expect(deployEnvironmentUpdate.inputSchema.shape).toHaveProperty(
      "transition",
    );
    expect(deployEnvironmentUpdate.inputSchema.shape).toHaveProperty(
      "enableService",
    );
  });
});

describe("deploy reads require cloud auth", () => {
  it("list throws an actionable not-authorized error", async () => {
    await expect(
      deployEnvironmentList.execute({ scope: "MINE" }, cloudCtx()),
    ).rejects.toThrow(/Not authorized/);
  });

  it("get throws not-authorized while resolving an environment", async () => {
    await expect(
      deployEnvironmentGet.execute({ name: "anything", full: false }, cloudCtx()),
    ).rejects.toThrow(/Not authorized/);
  });

  it("get still requires a name first", async () => {
    await expect(
      deployEnvironmentGet.execute({ name: "", full: false }, cloudCtx()),
    ).rejects.toThrow(/Missing required option --name/);
  });
});

describe("deploy writes require cloud auth", () => {
  it("create refuses without a signed-in identity", async () => {
    await expect(
      deployEnvironmentCreate.execute(
        { name: "My Product", services: ["CONNECT", "SWITCHBOARD"] },
        cloudCtx(),
      ),
    ).rejects.toThrow(/Not authorized/);
  });

  it("update refuses without a signed-in identity", async () => {
    await expect(
      deployEnvironmentUpdate.execute(
        { name: "some-env", label: "Renamed" },
        cloudCtx(),
      ),
    ).rejects.toThrow(/Not authorized/);
  });

  it("update still requires a name first", async () => {
    await expect(
      deployEnvironmentUpdate.execute({ name: "", label: "Renamed" }, cloudCtx()),
    ).rejects.toThrow(/Missing required option --name/);
  });
});
