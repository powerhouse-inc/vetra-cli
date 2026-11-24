import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { createRequestAuthorizer } from "../../src/preview-server/request-auth.js";
import { startPreviewServer } from "../../src/preview-server/server.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
// Bearer "owner-token" verifies as the owner's wallet; anything else doesn't.
const authorizeRequest = createRequestAuthorizer({
  renownUrl: "http://renown.invalid",
  cloud: false,
  audience: () => "https://studio.example",
  verifyBearer: async (jwt) =>
    jwt === "owner-token" ? { address: OWNER, appDid: "did:key:z6Mk" } : false,
  dataDir: "/unused",
  verifyCredential: async () => true,
});

describe("POST /restart", () => {
  let workdir: string;
  let cleanup: () => void;
  let projectPath: string;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  let stop: Mock<(id: string, instanceId?: string) => Promise<void>>;
  let start: Mock<() => Promise<string>>;
  const secret = process.env.VETRA_SESSION_EXPORT_SECRET;
  const admins = process.env.ADMINS;

  beforeEach(async () => {
    delete process.env.VETRA_SESSION_EXPORT_SECRET;
    delete process.env.ADMINS;
    ({ workdir, cleanup } = makeWorkdir());
    // The workdir is the project (makeWorkdir writes its powerhouse.config.json).
    projectPath = workdir;
    stop = vi.fn(async () => {});
    start = vi.fn(async () => "fresh");
    const list = vi.fn(() => [
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

  function restart(headers: Record<string, string> = {}) {
    return fetch(`http://127.0.0.1:${server.port}/restart`, {
      method: "POST",
      headers,
    });
  }

  it("restarts a stuck project for a direct loopback caller", async () => {
    const res = await restart();
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ kind: "started", instanceId: "fresh" });
    expect(stop).toHaveBeenCalledWith("reactor-project", "stuck");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("refuses an unauthenticated caller through the proxy (401)", async () => {
    const res = await restart({ "x-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(401);
    expect(stop).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("lets the signed-in owner restart through the proxy", async () => {
    process.env.ADMINS = OWNER;
    const res = await restart({
      "x-forwarded-for": "203.0.113.9",
      authorization: "Bearer owner-token",
    });
    expect(res.status).toBe(202);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("with a secret set, a local Studio stays local; a proxied request needs the secret", async () => {
    process.env.VETRA_SESSION_EXPORT_SECRET = "s3cret";
    expect((await restart()).status).toBe(202);
    expect(
      (await restart({ "x-forwarded-for": "203.0.113.9" })).status,
    ).toBe(401);
    expect(
      (
        await restart({
          "x-forwarded-for": "203.0.113.9",
          authorization: "Bearer s3cret",
        })
      ).status,
    ).toBe(202);
  });
});
