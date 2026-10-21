import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { makeWorkdir } from "../spec/_fixtures.js";

// The owner check reads the Studio's Renown sign-in; stub it per test.
let owner = false;
jest.unstable_mockModule("../../src/auth/renown.js", () => ({
  isAuthorizedAdmin: jest.fn(async () => owner),
  getAuthState: jest.fn(async () => ({ authenticated: false })),
  startAuth: jest.fn(),
  confirmAuth: jest.fn(),
  logoutAuth: jest.fn(),
  getRenown: jest.fn(),
  isAdminAddress: jest.fn(() => false),
  getBearerToken: jest.fn(),
  getRegistryToken: jest.fn(),
  getSigner: jest.fn(),
  getRenownStatus: jest.fn(),
}));
const { startPreviewServer } = await import("../../src/preview-server/server.js");

const PROJECT = "demo-project";

describe("POST /restart", () => {
  let workdir: string;
  let cleanup: () => void;
  let projectPath: string;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  let stop: jest.Mock<(id: string, instanceId?: string) => Promise<void>>;
  let start: jest.Mock<() => Promise<string>>;
  const secret = process.env.VETRA_SESSION_EXPORT_SECRET;

  beforeEach(async () => {
    delete process.env.VETRA_SESSION_EXPORT_SECRET;
    owner = false;
    ({ workdir, cleanup } = makeWorkdir());
    projectPath = join(workdir, PROJECT);
    mkdirSync(projectPath);
    writeFileSync(join(projectPath, "powerhouse.config.json"), "{}\n");
    stop = jest.fn(async () => {});
    start = jest.fn(async () => "fresh");
    const list = jest.fn(() => [
      { workdir: projectPath, status: "starting", instanceId: "stuck" },
    ]);
    server = await startPreviewServer({
      services: { list, start, stop } as never,
      subscribe: () => {},
      workdir,
      renownUrl: "http://renown.invalid",
      port: 0,
      versions: { vetraCli: "test", ph: "test" },
    });
  });

  afterEach(async () => {
    await server.stop();
    cleanup();
    if (secret === undefined) delete process.env.VETRA_SESSION_EXPORT_SECRET;
    else process.env.VETRA_SESSION_EXPORT_SECRET = secret;
  });

  function restart(project: string, headers: Record<string, string> = {}) {
    return fetch(`http://127.0.0.1:${server.port}/restart?project=${project}`, {
      method: "POST",
      headers,
    });
  }

  it("restarts a stuck project for a direct loopback caller", async () => {
    const res = await restart(PROJECT);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ kind: "started", instanceId: "fresh" });
    expect(stop).toHaveBeenCalledWith("reactor-project", "stuck");
    expect(start).toHaveBeenCalledTimes(1);

    const missing = await restart("nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ kind: "unknown-project" });
  });

  it("refuses a caller through the proxy who isn't the owner (403)", async () => {
    const res = await restart(PROJECT, { "x-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(403);
    expect(stop).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("lets the signed-in owner restart through the proxy", async () => {
    owner = true;
    const res = await restart(PROJECT, { "x-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(202);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("with a secret set, refuses a request without it", async () => {
    process.env.VETRA_SESSION_EXPORT_SECRET = "s3cret";
    expect((await restart(PROJECT)).status).toBe(403);
    expect(
      (await restart(PROJECT, { authorization: "Bearer s3cret" })).status,
    ).toBe(202);
  });
});
