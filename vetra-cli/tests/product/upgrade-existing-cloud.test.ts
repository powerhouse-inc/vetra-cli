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
  { id: "env-broken", status: "READY" },
  { id: "env-mixed", status: "READY" },
  { id: "env-elsewhere", status: "READY" },
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
  "env-mixed": {
    status: "READY",
    genericSubdomain: "mixed",
    apexService: "CONNECT",
    packages: [
      { name: "@vetra-apps/todo", registry: "https://registry.vetra.io" },
      { name: "@acme/other", registry: "https://registry.vetra.io" },
      { name: "@powerhousedao/common", registry: "https://registry.vetra.io" },
    ],
    services: [],
  },
  "env-elsewhere": {
    status: "READY",
    genericSubdomain: "elsewhere",
    apexService: "CONNECT",
    packages: [
      { name: "@vetra-apps/todo", registry: "https://registry.dev.vetra.io/" },
      { name: "@powerhousedao/common", registry: "https://registry.vetra.io" },
    ],
    services: [],
  },
};
let failure = "";
const loadEnvironmentState = jest.fn(async (_ctx: unknown, id: string) => {
  if (id === "env-broken") throw new Error("Document not found: env-broken");
  if (id === "env-flaky") throw new Error(failure);
  return STATES[id];
});

jest.unstable_mockModule("../../src/cloud/environments-read.js", () => ({
  listMyEnvironments,
  NOT_AUTHENTICATED: "Not authorized",
}));
jest.unstable_mockModule("../../src/cloud/environments-write.js", () => ({ loadEnvironmentState }));

const { findOwnerEnvironmentsRunning, isGoneError } = await import("../../src/product/upgrade-existing.js");

describe("findOwnerEnvironmentsRunning", () => {
  const ctx = { workdir: "/tmp/x", config: { environmentId: "studio-env" }, log: { warn: () => {} } } as never;

  it("finds the owner's environments that run the workspace, reading only", async () => {
    const found = await findOwnerEnvironmentsRunning(ctx, { names: ["@vetra-apps/todo"], registries: [] });
    expect(found.map((e) => e.environmentId)).toEqual(["env-old", "env-mixed", "env-elsewhere"]);
    expect(found[0]).toEqual({ environmentId: "env-old", url: "https://bold-crow-connect.vetra.io" });
    // Other non-system packages make it ambiguous; system packages don't.
    expect(found[1].mismatch).toMatch(/@acme\/other/);
    expect(found[2].mismatch).toBeUndefined();
    expect(listMyEnvironments).toHaveBeenCalledWith(ctx, "MINE");
    // The Studio itself and an env already gone by its summary are never loaded;
    // one whose state can't be read is skipped without failing the list.
    const loaded = loadEnvironmentState.mock.calls.map((c) => c[1]);
    expect(loaded).not.toContain("studio-env");
    expect(loaded).not.toContain("env-gone");
    expect(loaded).toContain("env-broken");
  });

  it("the workspace's packages from another registry make it ambiguous", async () => {
    const found = await findOwnerEnvironmentsRunning(ctx, {
      names: ["@vetra-apps/todo"],
      registries: ["https://registry.vetra.io"],
    });
    const byId = Object.fromEntries(found.map((e) => [e.environmentId, e.mismatch]));
    expect(byId["env-elsewhere"]).toMatch(/another registry/);
    // No registry recorded on the package: not compared.
    expect(byId["env-old"]).toBeUndefined();
  });

  it("any other read failure leaves the answer pending (throws), never a different choice", async () => {
    for (failure of ["Not authorized", "fetch failed", "HTTP 503 Service Unavailable"]) {
      listMyEnvironments.mockImplementationOnce(async () => [
        { id: "env-old", status: "READY" },
        { id: "env-flaky", status: "READY" },
      ]);
      await expect(
        findOwnerEnvironmentsRunning(ctx, { names: ["@vetra-apps/todo"], registries: [] }),
      ).rejects.toThrow(failure);
    }
  });

  it("tells a gone environment from a passing failure", () => {
    expect(isGoneError(new Error("Document not found: x"))).toBe(true);
    expect(isGoneError(new Error("HTTP 404"))).toBe(true);
    expect(isGoneError(new Error("fetch failed"))).toBe(false);
    expect(isGoneError(new Error("HTTP 502 Bad Gateway"))).toBe(false);
    expect(isGoneError(new Error("Not authorized — you can't act as the user"))).toBe(false);
  });

  it("asks nothing when the workspace has no packages", async () => {
    listMyEnvironments.mockClear();
    expect(await findOwnerEnvironmentsRunning(ctx, { names: [], registries: [] })).toEqual([]);
    expect(listMyEnvironments).not.toHaveBeenCalled();
  });
});
