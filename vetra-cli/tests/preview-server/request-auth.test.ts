import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { MemoryKeyStorage, RenownCryptoBuilder } from "@renown/sdk/node";

import { createRequestAuthorizer, isLocalRequest } from "../../src/preview-server/request-auth.js";

const OWNER = "0x00000000000000000000000000000000000000aa";
const STUDIO = "https://studio-1.vetra.example";

function req(headers: Record<string, string>, remoteAddress = "127.0.0.1"): IncomingMessage {
  return {
    headers: { host: "127.0.0.1:5180", ...headers },
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

async function mintToken(
  address: string,
  opts: { expiresIn?: number; aud?: string | null } = {},
): Promise<string> {
  const crypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(new MemoryKeyStorage())
    .build();
  const aud = opts.aud === undefined ? STUDIO : opts.aud;
  return crypto.getBearerToken(address, {
    expiresIn: opts.expiresIn ?? 600,
    ...(aud ? { aud } : {}),
  });
}

function authorizer(verifyDelegation: (jwt: string, aud: string) => Promise<boolean>, extra = {}) {
  return createRequestAuthorizer({
    renownUrl: "http://renown.invalid",
    cloud: true,
    audience: () => `${STUDIO}/preview`,
    verifyDelegation,
    ...extra,
  });
}

describe("createRequestAuthorizer with the real Renown token check", () => {
  const saved = { admins: process.env.ADMINS, secret: process.env.VETRA_SESSION_EXPORT_SECRET };
  let errorSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    process.env.ADMINS = OWNER;
    delete process.env.VETRA_SESSION_EXPORT_SECRET;
    // The SDK logs every rejected token; keep the run quiet.
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    if (saved.admins === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = saved.admins;
    if (saved.secret === undefined) delete process.env.VETRA_SESSION_EXPORT_SECRET;
    else process.env.VETRA_SESSION_EXPORT_SECRET = saved.secret;
  });

  it("a self-signed token claiming the owner's wallet is refused without the delegation", async () => {
    // Anyone can mint this: a fresh did:key signing a claim to OWNER's address.
    const forged = await mintToken(OWNER);
    const verifyDelegation = jest.fn(async () => false);
    const authorize = authorizer(verifyDelegation);
    const check = await authorize(req({ authorization: `Bearer ${forged}` }), null);
    expect(check).toMatchObject({ ok: false, status: 401 });
    expect(verifyDelegation).toHaveBeenCalledWith(forged, STUDIO);
  });

  it("accepts the owner's token once the delegation verifies; caches the verdict", async () => {
    const token = await mintToken(OWNER);
    const verifyDelegation = jest.fn(async () => true);
    const authorize = authorizer(verifyDelegation);
    const r = req({ authorization: `Bearer ${token}` });
    expect(await authorize(r, null)).toMatchObject({ ok: true, via: "owner" });
    expect(await authorize(r, null)).toMatchObject({ ok: true, via: "owner" });
    expect(verifyDelegation).toHaveBeenCalledTimes(1);
  });

  it("a verified token for another wallet is the same 401", async () => {
    const token = await mintToken("0x00000000000000000000000000000000000000bb");
    const authorize = authorizer(async () => true);
    expect(await authorize(req({ authorization: `Bearer ${token}` }), null)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("an expired or tampered token is 401", async () => {
    const authorize = authorizer(async () => true);
    const expired = await mintToken(OWNER, { expiresIn: -60 });
    expect(await authorize(req({ authorization: `Bearer ${expired}` }), null)).toMatchObject({
      ok: false,
      status: 401,
    });
    const good = await mintToken(OWNER);
    const [h, p, s] = good.split(".");
    const tampered = `${h}.${p}.${s.slice(0, -4)}AAAA`;
    expect(await authorize(req({ authorization: `Bearer ${tampered}` }), null)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await authorize(req({ authorization: "Bearer not-a-jwt" }), null)).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});

describe("bearer is bound to this Studio (aud)", () => {
  const saved = process.env.ADMINS;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    process.env.ADMINS = OWNER;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    if (saved === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = saved;
  });

  it("refuses a token minted for another Studio, or with no aud at all", async () => {
    const delegation = jest.fn(async () => true);
    const authorize = authorizer(delegation);
    const other = await mintToken(OWNER, { aud: "https://evil-studio.vetra.example" });
    const none = await mintToken(OWNER, { aud: null });
    for (const t of [other, none]) {
      expect(await authorize(req({ authorization: `Bearer ${t}` }), null)).toMatchObject({
        ok: false,
        status: 401,
      });
    }
    expect(delegation).not.toHaveBeenCalled();
    const mine = await mintToken(OWNER);
    expect(await authorize(req({ authorization: `Bearer ${mine}` }), null)).toMatchObject({
      ok: true,
    });
  });

  it("caps Renown lookups per minute; a flood of fresh tokens is refused", async () => {
    let t = 1_000_000;
    const delegation = jest.fn(async () => true);
    const authorize = authorizer(delegation, { lookupsPerMinute: 2, now: () => t });
    const tokens = await Promise.all([mintToken(OWNER), mintToken(OWNER), mintToken(OWNER)]);
    const results = [];
    for (const tok of tokens) results.push(await authorize(req({ authorization: `Bearer ${tok}` }), null));
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(delegation).toHaveBeenCalledTimes(2);
    t += 60_000;
    expect((await authorize(req({ authorization: `Bearer ${tokens[2]}` }), null)).ok).toBe(true);
  });
});

describe("isLocalRequest", () => {
  it("direct loopback, no origin", () => {
    expect(isLocalRequest(req({}))).toBe(true);
    expect(isLocalRequest(req({}, "::1"))).toBe(true);
    expect(isLocalRequest(req({}, "::ffff:127.0.0.1"))).toBe(true);
  });
  it("refuses a non-loopback socket or hop", () => {
    expect(isLocalRequest(req({}, "10.0.0.5"))).toBe(false);
    expect(isLocalRequest(req({ "x-forwarded-for": "10.0.0.5" }))).toBe(false);
    expect(isLocalRequest(req({ "x-forwarded-for": "127.0.0.1, 10.0.0.5" }))).toBe(false);
    expect(isLocalRequest(req({ "x-forwarded-for": "127.0.0.1" }))).toBe(true);
  });
  it("refuses a non-loopback Host or forwarded host (DNS rebinding)", () => {
    expect(isLocalRequest(req({ host: "attacker.example:5180" }))).toBe(false);
    expect(isLocalRequest(req({ "x-forwarded-host": "attacker.example:8090" }))).toBe(false);
    expect(isLocalRequest(req({ "x-forwarded-host": "localhost:8090" }))).toBe(true);
  });
  it("refuses a cross-site origin", () => {
    expect(isLocalRequest(req({ origin: "http://localhost:8090" }))).toBe(true);
    expect(isLocalRequest(req({ origin: "https://evil.example" }))).toBe(false);
    expect(isLocalRequest(req({ origin: "null" }))).toBe(false);
  });
});
