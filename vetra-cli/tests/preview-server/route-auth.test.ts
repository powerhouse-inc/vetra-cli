import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { createRequestAuthorizer } from "../../src/preview-server/request-auth.js";
import { startPreviewServer } from "../../src/preview-server/server.js";
import { makeWorkdir } from "../spec/_fixtures.js";

// Every preview-server route, public or owner-only. A route missing here is a
// route nobody decided on: keep the list in step with server.ts.
const OWNER_ROUTES: Array<[method: string, path: string]> = [
  ["GET", "/project-package?project=demo"],
  ["GET", "/release-status?project=demo"],
  ["POST", "/publish?project=demo"],
  ["POST", "/start?project=demo"],
  ["POST", "/restart?project=demo"],
  ["GET", "/sessions"],
  ["GET", "/sessions/export?id=s1"],
  ["GET", "/export?workspace=1"],
  ["GET", "/auth/status"],
  ["POST", "/auth/start"],
  ["POST", "/auth/confirm?wait=0"],
  ["POST", "/auth/logout"],
  ["POST", "/workshop/material?name=a.txt&type=text%2Fplain"],
  ["POST", "/workshop/understand"],
  ["GET", "/workshop/imports"],
  ["POST", "/workshop/imports/run"],
  ["GET", "/iterate/healthz"],
];
const PUBLIC_ROUTES: Array<[method: string, path: string]> = [
  ["GET", "/healthz"],
  ["GET", "/version"],
  ["GET", "/resolve?project=demo&doc=x"],
  ["GET", "/export/status"],
];

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const PROXIED = { "x-forwarded-for": "203.0.113.9", "x-forwarded-prefix": "/preview" };
const STUDIO = "https://studio-1.vetra.example";

describe("preview-server route gate", () => {
  let workdir: string;
  let cleanup: () => void;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  let start: jest.Mock<() => Promise<string>>;
  let delegation: jest.Mock<(jwt: string, audience: string) => Promise<boolean>>;
  let publicUrl: string | undefined;
  let audiences: string[];
  const saved = {
    secret: process.env.VETRA_SESSION_EXPORT_SECRET,
    admins: process.env.ADMINS,
  };

  async function boot(cloud: boolean) {
    ({ workdir, cleanup } = makeWorkdir());
    mkdirSync(join(workdir, "demo"));
    writeFileSync(join(workdir, "demo", "powerhouse.config.json"), "{}\n");
    writeFileSync(join(workdir, "README.md"), "hello\n");
    start = jest.fn(async () => "i-1");
    delegation = jest.fn(async () => true);
    audiences = [];
    server = await startPreviewServer({
      services: { list: () => [], start, stop: jest.fn(async () => {}) } as never,
      subscribe: () => {},
      workdir,
      renownUrl: "http://renown.invalid",
      port: 0,
      versions: { vetraCli: "test", ph: "test" },
      authorizeRequest: createRequestAuthorizer({
        renownUrl: "http://renown.invalid",
        cloud,
        audience: () => publicUrl,
        verifyBearer: async (jwt, audience) => {
          audiences.push(audience);
          return jwt === "owner-token"
            ? { address: OWNER, appDid: "did:key:z6MkOwner" }
            : jwt === "other-token"
              ? { address: OTHER, appDid: "did:key:z6MkOther" }
              : false;
        },
        verifyDelegation: delegation,
      }),
    });
  }

  function call(method: string, path: string, headers: Record<string, string> = {}) {
    return fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers });
  }

  beforeEach(() => {
    delete process.env.VETRA_SESSION_EXPORT_SECRET;
    process.env.ADMINS = OWNER;
    publicUrl = STUDIO;
  });

  afterEach(async () => {
    await server?.stop();
    cleanup?.();
    for (const [k, env] of [
      ["secret", "VETRA_SESSION_EXPORT_SECRET"],
      ["admins", "ADMINS"],
    ] as const) {
      if (saved[k] === undefined) delete process.env[env];
      else process.env[env] = saved[k];
    }
  });

  describe("cloud Studio", () => {
    beforeEach(() => boot(true));

    it.each(OWNER_ROUTES)("%s %s: unauthenticated → 401", async (method, path) => {
      const res = await call(method, path, PROXIED);
      expect(res.status).toBe(401);
    });

    it.each(OWNER_ROUTES)("%s %s: a direct loopback call is not enough → 401", async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
    });

    it.each(OWNER_ROUTES)("%s %s: a non-owner wallet → 401 (same as no token: no owner oracle)", async (method, path) => {
      const res = await call(method, path, { ...PROXIED, authorization: "Bearer other-token" });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it.each(OWNER_ROUTES)("%s %s: a forged / unverifiable bearer → 401", async (method, path) => {
      const res = await call(method, path, { ...PROXIED, authorization: "Bearer forged" });
      expect(res.status).toBe(401);
    });

    it.each(OWNER_ROUTES)("%s %s: the owner's bearer passes the gate", async (method, path) => {
      const res = await call(method, path, { ...PROXIED, authorization: "Bearer owner-token" });
      expect([401, 403]).not.toContain(res.status);
    });

    it.each(PUBLIC_ROUTES)("%s %s: public, no credential needed", async (method, path) => {
      expect((await call(method, path, PROXIED)).status).toBe(200);
    });

    it("the owner downloads the workspace zip; nobody else does", async () => {
      const owner = await call("GET", "/export?workspace=1", {
        ...PROXIED,
        authorization: "Bearer owner-token",
      });
      expect(owner.status).toBe(200);
      expect(owner.headers.get("content-type")).toBe("application/zip");
      expect((await owner.arrayBuffer()).byteLength).toBeGreaterThan(0);
    });

    it("owner tokens are checked against this Studio's public origin as aud", async () => {
      publicUrl = `${STUDIO}/some/base`;
      await call("GET", "/auth/status", { ...PROXIED, authorization: "Bearer owner-token" });
      expect(audiences).toEqual([STUDIO]);
    });

    it("no known public origin: every bearer is refused", async () => {
      publicUrl = undefined;
      const res = await call("GET", "/auth/status", { ...PROXIED, authorization: "Bearer owner-token" });
      expect(res.status).toBe(401);
    });

    it("/resolve leaks no absolute path or raw error text", async () => {
      const res = await call("GET", "/resolve?project=nope&doc=x", PROXIED);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ kind: "unknown-project", project: "nope", error: "unknown project" });
      const stopped = await call("GET", "/resolve?project=demo&doc=x", PROXIED);
      const s = (await stopped.json()) as Record<string, unknown>;
      expect(s.kind).toBe("project-stopped");
      expect(s).not.toHaveProperty("projectPath");
      expect(JSON.stringify(s)).not.toContain(workdir);
    });

    it("an owner wallet whose delegation doesn't verify on Renown → 401", async () => {
      delegation.mockResolvedValue(false);
      const res = await call("GET", "/auth/status", { ...PROXIED, authorization: "Bearer owner-token" });
      expect(res.status).toBe(401);
    });

    it("a non-owner never costs a Renown lookup", async () => {
      await call("GET", "/auth/status", { ...PROXIED, authorization: "Bearer other-token" });
      expect(delegation).not.toHaveBeenCalled();
    });

    it("/export/status answers for the caller", async () => {
      const anon = await call("GET", "/export/status", PROXIED);
      expect(await anon.json()).toEqual({ authorized: false });
      const other = await call("GET", "/export/status", { ...PROXIED, authorization: "Bearer other-token" });
      expect(await other.json()).toEqual({ authorized: false });
      const owner = await call("GET", "/export/status", { ...PROXIED, authorization: "Bearer owner-token" });
      expect(await owner.json()).toEqual({ authorized: true });
    });

    it("unauthenticated /auth/logout and /auth/start change nothing", async () => {
      await call("POST", "/auth/logout", PROXIED);
      await call("POST", "/auth/start", PROXIED);
      await call("POST", "/start?project=demo", PROXIED);
      expect(start).not.toHaveBeenCalled();
    });

    it("ADMINS unset: fails closed, even for a valid bearer", async () => {
      delete process.env.ADMINS;
      const res = await call("GET", "/export?workspace=1", {
        ...PROXIED,
        authorization: "Bearer owner-token",
      });
      expect(res.status).toBe(401);
      expect((await call("GET", "/export?workspace=1")).status).toBe(401);
    });

    it("the operator secret downloads the export (header or ?token=)", async () => {
      process.env.VETRA_SESSION_EXPORT_SECRET = "s3cret";
      const viaHeader = await call("GET", "/export?workspace=1", {
        ...PROXIED,
        authorization: "Bearer s3cret",
      });
      expect(viaHeader.status).toBe(200);
      await viaHeader.arrayBuffer();
      const viaQuery = await call("GET", "/export?workspace=1&token=s3cret", PROXIED);
      expect(viaQuery.status).toBe(200);
      await viaQuery.arrayBuffer();
      const wrong = await call("GET", "/export?workspace=1", {
        ...PROXIED,
        authorization: "Bearer s3cre",
      });
      expect(wrong.status).toBe(401);
    });
  });

  describe("local Studio (no environment id, no ADMINS)", () => {
    beforeEach(async () => {
      delete process.env.ADMINS;
      await boot(false);
    });

    it.each(OWNER_ROUTES)("%s %s: a direct loopback caller passes", async (method, path) => {
      expect([401, 403]).not.toContain((await call(method, path)).status);
    });

    it("the local proxy (loopback x-forwarded-for) passes", async () => {
      const res = await call("GET", "/auth/status", {
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-prefix": "/preview",
        origin: "http://localhost:8090",
      });
      expect(res.status).toBe(200);
    });

    it("a LAN client through the 0.0.0.0 proxy is refused", async () => {
      const res = await call("GET", "/export?workspace=1", { "x-forwarded-for": "192.168.1.20" });
      expect(res.status).toBe(401);
      // A spoofed loopback entry doesn't help: the proxy appends the real hop.
      const spoofed = await call("GET", "/export?workspace=1", {
        "x-forwarded-for": "127.0.0.1,192.168.1.20",
      });
      expect(spoofed.status).toBe(401);
    });

    it("a DNS-rebinding Host (no Origin) is refused", async () => {
      // fetch won't send a custom Host; use node:http as a rebinding browser would.
      const direct = await new Promise<number>((resolve, reject) => {
        const r = request(
          {
            host: "127.0.0.1",
            port: server.port,
            path: "/auth/status",
            headers: { host: "attacker.example:5180" },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        r.on("error", reject);
        r.end();
      });
      expect(direct).toBe(401);
      const proxied = await call("GET", "/auth/status", {
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": "attacker.example:8090",
      });
      expect(proxied.status).toBe(401);
    });

    it("a cross-site browser origin is refused", async () => {
      const res = await call("GET", "/auth/status", { origin: "https://evil.example" });
      expect(res.status).toBe(401);
    });

    it("with an ADMINS list set it is no longer local: bearer required", async () => {
      process.env.ADMINS = OWNER;
      expect((await call("GET", "/auth/status")).status).toBe(401);
      expect(
        (await call("GET", "/auth/status", { authorization: "Bearer owner-token" })).status,
      ).toBe(200);
    });
  });
});
