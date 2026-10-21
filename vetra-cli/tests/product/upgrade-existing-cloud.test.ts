/**
 * Which environment ran an existing Studio's work (Task 3.7, F28): only the
 * owner's environments are read, never written; the Studio itself, other
 * Studios and environments that are gone never count.
 */
import { describe, expect, it, jest } from "@jest/globals";

const listMyEnvironments = jest.fn(async () => [
  { id: "studio-env", status: "READY" },
  { id: "env-old", status: "READY" },
  { id: "env-other-studio", status: "READY" },
  { id: "env-gone", status: "TERMINATING" },
  { id: "env-archived-doc", status: null },
  { id: "env-unrelated", status: "READY" },
]);

const STATES: Record<string, unknown> = {
  "studio-env": { status: "READY", genericSubdomain: "me", packages: [{ name: "@vetra-apps/todo" }], services: [] },
  "env-old": {
    status: "READY",
    genericSubdomain: "bold-crow",
    genericBaseDomain: null,
    apexService: null,
    packages: [{ name: "@vetra-apps/todo" }],
    services: [{ type: "CONNECT", enabled: true, prefix: "connect" }],
  },
  "env-other-studio": {
    status: "READY",
    genericSubdomain: "other",
    packages: [{ name: "vetra" }, { name: "@vetra-apps/todo" }],
    services: [],
  },
  "env-archived-doc": { status: "ARCHIVED", genericSubdomain: "old", packages: [{ name: "@vetra-apps/todo" }], services: [] },
  "env-unrelated": { status: "READY", genericSubdomain: "else", packages: [{ name: "@acme/other" }], services: [] },
};
const loadEnvironmentState = jest.fn(async (_ctx: unknown, id: string) => STATES[id]);

jest.unstable_mockModule("../../src/cloud/environments-read.js", () => ({ listMyEnvironments }));
jest.unstable_mockModule("../../src/cloud/environments-write.js", () => ({ loadEnvironmentState }));

const { findOwnerEnvironmentsRunning } = await import("../../src/product/upgrade-existing.js");

describe("findOwnerEnvironmentsRunning", () => {
  const ctx = { workdir: "/tmp/x", config: { environmentId: "studio-env" } } as never;

  it("finds the one environment of the owner that runs the workspace, reading only", async () => {
    expect(await findOwnerEnvironmentsRunning(ctx, ["@vetra-apps/todo"])).toEqual([
      { environmentId: "env-old", url: "https://bold-crow-connect.vetra.io" },
    ]);
    expect(listMyEnvironments).toHaveBeenCalledWith(ctx, "MINE");
    // The Studio itself and an env already gone by its summary are never loaded.
    const loaded = loadEnvironmentState.mock.calls.map((c) => c[1]);
    expect(loaded).not.toContain("studio-env");
    expect(loaded).not.toContain("env-gone");
  });

  it("asks nothing when the workspace has no packages", async () => {
    listMyEnvironments.mockClear();
    expect(await findOwnerEnvironmentsRunning(ctx, [])).toEqual([]);
    expect(listMyEnvironments).not.toHaveBeenCalled();
  });
});
