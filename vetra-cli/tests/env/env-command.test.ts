import { describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EnvironmentSummary } from "@powerhousedao/vetra-cloud-client";
import {
  createEnvCommand,
  envCommand,
  type EnvApi,
} from "../../src/commands/env/env.js";
import { resolveEnvRef } from "../../src/commands/env/resolve.js";
import { formatList } from "../../src/commands/env/format.js";

const summary = (
  id: string,
  name: string,
  subdomain: string,
  status = "READY",
): EnvironmentSummary => ({
  id,
  name,
  subdomain,
  status,
  customDomain: null,
  owner: "0xabc",
  createdBy: "0xabc",
});

const ENVS = [
  summary("doc-1", "Shop", "bold-fox-11111111", "CHANGES_PENDING"),
  summary("doc-2", "Blog", "keen-yak-22222222"),
  summary("doc-3", "twin", "calm-elk-33333333"),
  summary("doc-4", "Twin", "wise-owl-44444444"),
];

function state(over: Record<string, unknown> = {}) {
  return {
    label: "Shop",
    status: "CHANGES_PENDING",
    genericSubdomain: "bold-fox-11111111",
    genericBaseDomain: "vetra.io",
    services: [
      { type: "CONNECT", prefix: "connect", enabled: true, selectedRessource: null, version: "v6.2.0" },
      { type: "SWITCHBOARD", prefix: "switchboard", enabled: false, selectedRessource: "VETRA_AGENT_M", version: null },
    ],
    packages: [{ name: "@acme/todo", version: "1.2.0", registry: "https://registry.vetra.io" }],
    ...over,
  };
}

/** Fake cloud: `dispatch` runs the command's callback against an in-memory
 * controller stand-in whose action methods record calls and update state. */
function fakeApi(initial = state()) {
  const current = { global: { ...initial, packages: [...initial.packages] } };
  const calls: { type: string; input: unknown }[] = [];
  const target = {
    state: current,
    addPackage: (input: { packageName: string; version?: string }) => {
      calls.push({ type: "ADD_PACKAGE", input });
      current.global.packages.push({ name: input.packageName, version: input.version ?? "latest", registry: "r" });
      current.global.status = "CHANGES_PENDING";
    },
    removePackage: (input: { packageName: string }) => {
      calls.push({ type: "REMOVE_PACKAGE", input });
      current.global.packages = current.global.packages.filter((p) => p.name !== input.packageName);
      current.global.status = "CHANGES_PENDING";
    },
    approveChanges: (input: unknown) => {
      calls.push({ type: "APPROVE_CHANGES", input });
      current.global.status = "CHANGES_APPROVED";
    },
  };
  const api: EnvApi = {
    list: jest.fn(async () => ENVS),
    load: jest.fn(async () => ({
      state: current.global as never,
      operations: [
        { action: { type: "APPROVE_CHANGES", input: {} } },
        { action: { type: "ADD_PACKAGE", input: { packageName: "@acme/todo", version: "1.2.0" } } },
      ],
    })),
    dispatch: jest.fn(async (_id, apply) => {
      apply(target);
      return current.global as never;
    }),
  };
  return { api, calls };
}

const ctx = { workdir: "/tmp/unused", config: {} } as never;

function run(api: EnvApi, input: Record<string, unknown>) {
  const cmd = createEnvCommand(() => api);
  const parsed = cmd.inputSchema.parse(input);
  return cmd.execute(parsed, ctx) as Promise<{ text: string }>;
}

describe("env command shape", () => {
  it("is `vetra env <action> [env] [package] --json`", () => {
    expect(envCommand.id).toBe("env");
    expect(envCommand.positional).toEqual(["action", "env", "package"]);
    expect(Object.keys(envCommand.inputSchema.shape)).toEqual([
      "action",
      "env",
      "package",
      "json",
    ]);
  });

  it("rejects unknown actions and defaults the optional args", () => {
    expect(() => envCommand.inputSchema.parse({ action: "deploy" })).toThrow();
    expect(envCommand.inputSchema.parse({ action: "list" })).toEqual({
      action: "list",
      env: "",
      package: "",
      json: false,
    });
  });
});

describe("resolveEnvRef", () => {
  it("resolves id, subdomain, and case-insensitive name", () => {
    expect(resolveEnvRef(ENVS, "doc-2").id).toBe("doc-2");
    expect(resolveEnvRef(ENVS, "keen-yak-22222222").id).toBe("doc-2");
    expect(resolveEnvRef(ENVS, "blog").id).toBe("doc-2");
  });

  it("lists every match when a name is ambiguous", () => {
    expect(() => resolveEnvRef(ENVS, "twin")).toThrow(
      /ambiguous — 2 environments match:\n {2}twin \(calm-elk-33333333, doc-3\)\n {2}Twin \(wise-owl-44444444, doc-4\)\nPass the environment id instead\./,
    );
  });

  it("suggests names for an unknown reference", () => {
    expect(() => resolveEnvRef(ENVS, "Shpo")).toThrow(
      /Unknown environment "Shpo"\.\nDid you mean: Shop/,
    );
  });
});

describe("env list", () => {
  it("prints a table by default", async () => {
    const { api } = fakeApi();
    const { text } = await run(api, { action: "list" });
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^NAME\s+STATUS\s+SUBDOMAIN\s+ID$/);
    expect(lines[1]).toMatch(/^Shop\s+CHANGES_PENDING\s+bold-fox-11111111\s+doc-1$/);
    expect(lines).toHaveLength(5);
  });

  it("prints JSON with --json", async () => {
    const { api } = fakeApi();
    const { text } = await run(api, { action: "list", json: true });
    expect(JSON.parse(text)[1]).toEqual({
      id: "doc-2",
      name: "Blog",
      subdomain: "keen-yak-22222222",
      status: "READY",
    });
  });

  it("says so when there are none", () => {
    expect(formatList([])).toBe("No environments.");
  });
});

describe("env show", () => {
  it("prints status, services, packages, and pending changes", async () => {
    const { api } = fakeApi();
    const { text } = await run(api, { action: "show", env: "shop" });
    expect(api.load).toHaveBeenCalledWith("doc-1");
    expect(text).toContain("Shop  [CHANGES_PENDING]");
    expect(text).toContain("host:  bold-fox-11111111.vetra.io");
    expect(text).toMatch(/TYPE\s+PREFIX\s+ENABLED\s+SIZE/);
    expect(text).toMatch(/CONNECT\s+connect\s+yes\s+default/);
    expect(text).toMatch(/SWITCHBOARD\s+switchboard\s+no\s+VETRA_AGENT_M/);
    expect(text).toContain("  @acme/todo@1.2.0");
    expect(text).toContain("pending changes (since last approval):\n  - add package @acme/todo@1.2.0");
    expect(text).toContain("Approve with: vetra env approve doc-1");
  });

  it("omits pending changes outside CHANGES_PENDING and emits JSON", async () => {
    const { api } = fakeApi(state({ status: "READY" }));
    const json = JSON.parse((await run(api, { action: "show", env: "doc-1", json: true })).text);
    expect(json).toMatchObject({
      id: "doc-1",
      status: "READY",
      host: "bold-fox-11111111.vetra.io",
      pendingChanges: [],
      packages: [{ name: "@acme/todo", version: "1.2.0" }],
    });
    expect(json.services[1]).toEqual({
      type: "SWITCHBOARD",
      prefix: "switchboard",
      enabled: false,
      size: "VETRA_AGENT_M",
      version: null,
    });
  });

  it("requires <env>", async () => {
    const { api } = fakeApi();
    await expect(run(api, { action: "show" })).rejects.toThrow(
      "Missing <env>.\nUsage: vetra env show <env>",
    );
  });
});

describe("env add-package / remove-package", () => {
  it("dispatches ADD_PACKAGE with name and version", async () => {
    const { api, calls } = fakeApi(state({ status: "READY" }));
    const { text } = await run(api, {
      action: "add-package",
      env: "shop",
      package: "@acme/blog@2.0.0",
    });
    expect(calls).toEqual([
      { type: "ADD_PACKAGE", input: { packageName: "@acme/blog", version: "2.0.0" } },
    ]);
    expect(text).toContain('Added @acme/blog@2.0.0 to "Shop" — status CHANGES_PENDING.');
    expect(text).toContain("Deploy with: vetra env approve doc-1");
  });

  it("dispatches ADD_PACKAGE without a version", async () => {
    const { api, calls } = fakeApi();
    await run(api, { action: "add-package", env: "doc-1", package: "@acme/blog" });
    expect(calls[0].input).toEqual({ packageName: "@acme/blog", version: undefined });
  });

  it("refuses Vetra Studio environments", async () => {
    const { api, calls } = fakeApi(
      state({ packages: [{ name: "vetra", version: "1.0.0", registry: "r" }] }),
    );
    await expect(
      run(api, { action: "add-package", env: "shop", package: "x" }),
    ).rejects.toThrow(/runs Vetra Studio/);
    expect(calls).toEqual([]);
  });

  it("requires <package>", async () => {
    const { api } = fakeApi();
    await expect(run(api, { action: "add-package", env: "shop" })).rejects.toThrow(
      "Missing <package>.\nUsage: vetra env add-package <env> <package>[@version]",
    );
  });

  it("dispatches REMOVE_PACKAGE for an installed package", async () => {
    const { api, calls } = fakeApi();
    const json = JSON.parse(
      (await run(api, { action: "remove-package", env: "shop", package: "@acme/todo", json: true })).text,
    );
    expect(calls).toEqual([{ type: "REMOVE_PACKAGE", input: { packageName: "@acme/todo" } }]);
    expect(json).toMatchObject({ action: "remove-package", id: "doc-1", packages: [] });
  });

  it("errors on a package that isn't installed, or a versioned name", async () => {
    const { api, calls } = fakeApi();
    await expect(
      run(api, { action: "remove-package", env: "shop", package: "@acme/nope" }),
    ).rejects.toThrow('Package "@acme/nope" is not installed on "Shop".\nInstalled: @acme/todo');
    await expect(
      run(api, { action: "remove-package", env: "shop", package: "@acme/todo@1.2.0" }),
    ).rejects.toThrow(/without a version/);
    expect(calls).toEqual([]);
  });
});

describe("env approve", () => {
  it("dispatches APPROVE_CHANGES from CHANGES_PENDING", async () => {
    const { api, calls } = fakeApi();
    const { text } = await run(api, { action: "approve", env: "shop" });
    expect(calls).toEqual([{ type: "APPROVE_CHANGES", input: {} }]);
    expect(text).toContain('Approved changes on "Shop" — status CHANGES_APPROVED.');
  });

  it("errors clearly from a non-approvable status without dispatching", async () => {
    const { api, calls } = fakeApi(state({ status: "READY" }));
    await expect(run(api, { action: "approve", env: "shop" })).rejects.toThrow(
      'Cannot approve "Shop": status is READY. Approve only applies from DRAFT or CHANGES_PENDING — there are no pending changes to deploy.',
    );
    expect(calls).toEqual([]);
  });
});

describe("env against the real cloud path", () => {
  it("fails with the shared not-authorized error when not signed in", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "vetra-env-test-"));
    const parsed = envCommand.inputSchema.parse({ action: "list" });
    await expect(
      envCommand.execute(parsed, {
        workdir,
        config: { cloudSwitchboardUrl: "http://localhost:5555" },
      } as never),
    ).rejects.toThrow(/Not authorized/);
  });
});
