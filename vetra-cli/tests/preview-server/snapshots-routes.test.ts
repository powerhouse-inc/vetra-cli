import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { createRequestAuthorizer } from "../../src/preview-server/request-auth.js";
import { startPreviewServer } from "../../src/preview-server/server.js";
import { SNAPSHOT_MAX_BYTES } from "../../src/workshop/snapshots-store.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
const PROXIED = { "x-forwarded-for": "203.0.113.9", "x-forwarded-prefix": "/preview" };
const OWNER_AUTH = { ...PROXIED, authorization: "Bearer owner-token" };

describe("/workshop/snapshots", () => {
  let workdir: string;
  let cleanup: () => void;
  let server: Awaited<ReturnType<typeof startPreviewServer>>;
  const admins = process.env.ADMINS;

  beforeEach(async () => {
    process.env.ADMINS = OWNER;
    ({ workdir, cleanup } = makeWorkdir());
    server = await startPreviewServer({
      services: { list: () => [], start: async () => "x", stop: async () => {} } as never,
      subscribe: () => {},
      workdir,
      renownUrl: "http://renown.invalid",
      port: 0,
      versions: { vetraCli: "test", ph: "test" },
      cloud: true,
      authorizeRequest: createRequestAuthorizer({
        renownUrl: "http://renown.invalid",
        cloud: true,
        audience: () => "https://studio.example",
        verifyBearer: async (jwt) =>
          jwt === "owner-token" ? { address: OWNER, appDid: "did:key:z6Mk" } : false,
        verifyDelegation: async () => true,
      }),
    });
  });

  afterEach(async () => {
    await server.stop();
    cleanup();
    if (admins === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = admins;
  });

  const url = (q: string) => `http://127.0.0.1:${server.port}/workshop/snapshots?${q}`;

  it("refuses a caller without the owner token", async () => {
    const res = await fetch(url("changeId=c1&at=2026-10-21T10:00:00Z"), {
      method: "POST",
      headers: PROXIED,
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(401);
  });

  it("stores snapshots and lists them by time", async () => {
    for (const at of ["2026-10-21T10:00:40Z", "2026-10-21T10:00:20Z"]) {
      const res = await fetch(url(`changeId=c1&at=${at}`), { method: "POST", headers: OWNER_AUTH, body: new Uint8Array([0xff, 0xd8, 1]) });
      expect(res.status).toBe(201);
    }
    const list = await fetch(url("changeId=c1"), { headers: OWNER_AUTH });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { at: string }[]).map((s) => s.at)).toEqual([
      "2026-10-21T100020Z",
      "2026-10-21T100040Z",
    ]);
  });

  it("a snapshot over 400 KB gets 413", async () => {
    const res = await fetch(url("changeId=c1&at=2026-10-21T10:00:00Z"), {
      method: "POST",
      headers: OWNER_AUTH,
      body: new Uint8Array(SNAPSHOT_MAX_BYTES + 1),
    });
    expect(res.status).toBe(413);
  });

  it("a bad change id or time gets 400", async () => {
    const res = await fetch(url("changeId=..%2Fx&at=2026-10-21T10:00:00Z"), { method: "POST", headers: OWNER_AUTH, body: new Uint8Array([1]) });
    expect(res.status).toBe(400);
  });
});
