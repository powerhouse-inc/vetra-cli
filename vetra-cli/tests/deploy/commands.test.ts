import { describe, expect, it } from "@jest/globals";

import { deployEnvironmentCreate } from "../../src/commands/deploy/create.js";
import { deployEnvironmentGet } from "../../src/commands/deploy/get.js";
import { deployEnvironmentList } from "../../src/commands/deploy/list.js";
import { deployEnvironmentUpdate } from "../../src/commands/deploy/update.js";

// The deploy commands ignore the command context (mock store is module state),
// so a bare stub is enough.
const ctx = {} as never;

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
      "enableService",
    );
  });
});

describe("deploy-environment commands against the mock store", () => {
  it("list returns the seeded environments", async () => {
    const result = await deployEnvironmentList.execute({ scope: "MINE" }, ctx);
    expect(result.text).toMatch(/Acme Production/);
    expect(result.text).toMatch(/acme-prod-1a2b3c4d\.vetra\.io/);
    expect(result.text).toMatch(/READY/);
  });

  it("list filters by status", async () => {
    const result = await deployEnvironmentList.execute(
      { scope: "MINE", status: "deploying" },
      ctx,
    );
    expect(result.text).toMatch(/Staging/);
    expect(result.text).not.toMatch(/Acme Production/);
  });

  it("get resolves a seed by name and renders detail", async () => {
    const result = await deployEnvironmentGet.execute(
      { name: "Acme Production", full: false },
      ctx,
    );
    expect(result.text).toMatch(/Acme Production\s+\[READY\]/);
    expect(result.text).toMatch(/CONNECT/);
    expect(result.text).toMatch(/@acme\/todo@1\.2\.0/);
  });

  it("get --filter projects the environment object", async () => {
    const result = await deployEnvironmentGet.execute(
      { name: "env-mock-0001", full: false, filter: "$.subdomain" },
      ctx,
    );
    expect(result.text).toMatch(/acme-prod-1a2b3c4d/);
  });

  it("get throws an actionable error for an unknown environment", async () => {
    await expect(
      deployEnvironmentGet.execute({ name: "nope", full: false }, ctx),
    ).rejects.toThrow(/Unknown environment/i);
  });

  it("create adds an environment that list and get then see", async () => {
    const created = await deployEnvironmentCreate.execute(
      { name: "My Product", services: ["CONNECT", "SWITCHBOARD"] },
      ctx,
    );
    expect(created.text).toMatch(/Created environment "My Product"/);
    expect(created.text).toMatch(/status: DRAFT/);

    const id = /id: (\S+)/.exec(created.text)?.[1];
    expect(id).toBeTruthy();

    const got = await deployEnvironmentGet.execute(
      { name: id!, full: true },
      ctx,
    );
    expect(got.text).toMatch(/"label": "My Product"/);
    expect(got.text).toMatch(/"status": "DRAFT"/);

    const listed = await deployEnvironmentList.execute(
      { scope: "MINE" },
      ctx,
    );
    expect(listed.text).toMatch(/My Product/);
  });

  it("update renames, toggles services, and manages packages", async () => {
    const created = await deployEnvironmentCreate.execute(
      { name: "Edit Me" },
      ctx,
    );
    const id = /id: (\S+)/.exec(created.text)?.[1] as string;

    const updated = await deployEnvironmentUpdate.execute(
      {
        name: id,
        label: "Renamed",
        status: "CHANGES_APPROVED",
        enableService: ["SWITCHBOARD"],
        addPackage: ["@acme/todo@2.0.0"],
      },
      ctx,
    );
    expect(updated.text).toMatch(/Updated environment "Renamed"/);
    expect(updated.text).toMatch(/CHANGES_APPROVED/);
    expect(updated.text).toMatch(/@acme\/todo@2\.0\.0/);

    const detail = await deployEnvironmentGet.execute(
      { name: id, full: false },
      ctx,
    );
    expect(detail.text).toMatch(/✓ SWITCHBOARD/);
  });
});
