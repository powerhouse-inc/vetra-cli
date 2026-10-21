import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createRequestAuthorizer } from "../../src/preview-server/request-auth.js";
import { startPreviewServer } from "../../src/preview-server/server.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
// Bearer "owner-token" verifies as the owner's wallet; anything else doesn't.
const authorizeRequest = createRequestAuthorizer({
  renownUrl: "http://renown.invalid",
  cloud: false,
  verifyBearer: async (jwt) =>
    jwt === "owner-token" ? { address: OWNER, appDid: "did:key:z6Mk" } : false,
  verifyDelegation: async () => true,
});

const PROJECT = "demo-project";

describe("POST /restart", () => {
  let workdir: string;
  let cleanup: () => void;
  let projectPath: string;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  let stop: jest.Mock<(id: string, instanceId?: string) => Promise<void>>;
  let start: jest.Mock<() => Promise<string>>;
  const secret = process.env.VETRA_SESSION_EXPORT_SECRET;
  const admins = process.env.ADMINS;

  beforeEach(async () => {
    delete process.env.VETRA_SESSION_EXPORT_SECRET;
    delete process.env.ADMINS;
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
      authorizeRequest,
    });
  });

  afterEach(async () => {
    await server.stop();
    cleanup();
    if (secret === undefined) delete process.env.VETRA_SESSION_EXPORT_SECRET;
    else process.env.VETRA_SESSION_EXPORT_SECRET = secret;
    if (admins === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = admins;
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

  it("refuses an unauthenticated caller through the proxy (401)", async () => {
    const res = await restart(PROJECT, { "x-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(401);
    expect(stop).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("lets the signed-in owner restart through the proxy", async () => {
    process.env.ADMINS = OWNER;
    const res = await restart(PROJECT, {
      "x-forwarded-for": "203.0.113.9",
      authorization: "Bearer owner-token",
    });
    expect(res.status).toBe(202);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("with a secret set, refuses a request without it", async () => {
    process.env.VETRA_SESSION_EXPORT_SECRET = "s3cret";
    expect((await restart(PROJECT)).status).toBe(401);
    expect(
      (await restart(PROJECT, { authorization: "Bearer s3cret" })).status,
    ).toBe(202);
  });
});
