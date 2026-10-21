import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { BodyError, createIterateRoutes, errorResponse } from "../../src/preview-server/iterate-routes.js";
import { StudioEditRefusedError } from "../../src/product/studio-edit.js";
import { createRequestAuthorizer } from "../../src/preview-server/request-auth.js";
import { startPreviewServer } from "../../src/preview-server/server.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const PROXIED = { "x-forwarded-for": "203.0.113.9", "x-forwarded-prefix": "/preview" };

describe("iterate routes", () => {
  let cleanup: () => void;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  const savedAdmins = process.env.ADMINS;

  beforeEach(async () => {
    process.env.ADMINS = OWNER;
    let workdir: string;
    ({ workdir, cleanup } = makeWorkdir());
    mkdirSync(join(workdir, "demo"));
    writeFileSync(join(workdir, "demo", "powerhouse.config.json"), "{}\n");
    server = await startPreviewServer({
      services: { list: () => [], start: jest.fn(), stop: jest.fn() } as never,
      subscribe: () => {},
      workdir,
      renownUrl: "http://renown.invalid",
      port: 0,
      versions: { vetraCli: "test", ph: "test" },
      authorizeRequest: createRequestAuthorizer({
        renownUrl: "http://renown.invalid",
        cloud: true,
        audience: () => "https://studio-1.vetra.example",
        verifyBearer: async (jwt) =>
          jwt === "owner-token"
            ? { address: OWNER, appDid: "did:key:z6MkOwner" }
            : jwt === "other-token"
              ? { address: OTHER, appDid: "did:key:z6MkOther" }
              : false,
        verifyDelegation: async () => true,
      }),
    });
  });

  afterEach(async () => {
    await server?.stop();
    cleanup?.();
    if (savedAdmins === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = savedAdmins;
  });

  function call(path: string, headers: Record<string, string> = {}) {
    return fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { ...PROXIED, ...headers } });
  }

  it("iterate routes refuse a caller without the owner token", async () => {
    for (const path of ["/iterate/healthz", "/iterate/unknown"]) {
      const anon = await call(path);
      expect([401, 403]).toContain(anon.status);
      const other = await call(path, { authorization: "Bearer other-token" });
      expect([401, 403]).toContain(other.status);
      expect(await other.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("owner gets ok", async () => {
    const res = await call("/iterate/healthz", { authorization: "Bearer owner-token" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // An iterate path no route answers is the server's 404, after the gate.
    const missing = await call("/iterate/nope", { authorization: "Bearer owner-token" });
    expect(missing.status).toBe(404);
  });

  it("route errors become plain JSON answers", () => {
    expect(errorResponse(new StudioEditRefusedError("Another change is in progress."))).toEqual({
      status: 409,
      body: { error: "Another change is in progress." },
    });
    expect(errorResponse(new BodyError(413, "body too large"))).toEqual({
      status: 413,
      body: { error: "body too large" },
    });
    expect(errorResponse(new Error("/secret/path failed"))).toEqual({ status: 500, body: { error: "internal" } });
  });

  it("a route that throws answers with a plain JSON error", async () => {
    const answers: Array<[number, unknown]> = [];
    const routes = createIterateRoutes({
      requireOwner: async () => true,
      writeJson: (_res, status, body) => {
        if (status === 200) throw new Error("/secret/path: write failed");
        answers.push([status, body]);
      },
      workdir: "/nowhere",
    });
    const res = { headersSent: false } as never;
    expect(await routes.handle({} as never, res, "/iterate/healthz", "GET")).toBe(true);
    expect(answers).toEqual([[500, { error: "internal" }]]);
  });
});
