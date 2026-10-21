import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { createRequestAuthorizer } from "../../src/preview-server/request-auth.js";
import { startPreviewServer } from "../../src/preview-server/server.js";
import { MATERIAL_MAX_BYTES } from "../../src/preview-server/body.js";
import { makeWorkdir } from "../spec/_fixtures.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "workshop");
const PROXIED = { "x-forwarded-for": "203.0.113.9", "x-forwarded-prefix": "/preview" };
const OWNER_AUTH = { ...PROXIED, authorization: "Bearer owner-token" };

describe("POST /workshop/material", () => {
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

  const materialDir = () => join(workdir, ".ph", "vetra", "material");
  const stored = () => (existsSync(materialDir()) ? readdirSync(materialDir()) : []);

  function upload(name: string, type: string, body: Uint8Array, headers: Record<string, string> = OWNER_AUTH) {
    const q = new URLSearchParams({ name, type });
    return fetch(`http://127.0.0.1:${server.port}/workshop/material?${q}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/octet-stream" },
      body,
    });
  }

  it("refuses a caller without the owner token", async () => {
    const res = await upload("photo.png", "image/png", readFileSync(join(FIXTURES, "photo.png")), PROXIED);
    expect(res.status).toBe(401);
    expect(stored()).toEqual([]);
  });

  it("stores a sheet and returns its tables", async () => {
    const res = await upload(
      "checklist.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      readFileSync(join(FIXTURES, "checklist.xlsx")),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id: expect.any(String),
      name: "checklist.xlsx",
      kind: "SHEET",
      sheets: [
        {
          sheet: "Prüfliste",
          header: ["Nr", "Prüfpunkt", "Datum", "Status", "Erledigt", "Bemerkung"],
          rowCount: 6,
        },
        { sheet: "Geräte", header: ["Gerät", "Standort", "Anzahl"], rowCount: 2 },
      ],
    });
    expect(stored()).toEqual([body.id]);
    expect(existsSync(join(materialDir(), String(body.id), "checklist.xlsx"))).toBe(true);
  });

  it("stores a picture without sheets", async () => {
    const res = await upload("photo.png", "image/png", readFileSync(join(FIXTURES, "photo.png")));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: expect.any(String), name: "photo.png", kind: "PICTURE" });
  });

  it("a file over 15 MB gets 413 and nothing is stored", async () => {
    const res = await upload("big.csv", "text/csv", new Uint8Array(MATERIAL_MAX_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too-large" });
    expect(stored()).toEqual([]);
  });

  it("unknown file type gets 415", async () => {
    const res = await upload("tool.exe", "application/octet-stream", new Uint8Array([0x4d, 0x5a, 0, 1]));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported" });
    expect(stored()).toEqual([]);
  });

  it("needs a file name", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/workshop/material`, {
      method: "POST",
      headers: OWNER_AUTH,
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(400);
  });
});
