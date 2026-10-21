import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const authorize = authorizer(delegation, {
      lookupsPerMinute: 2,
      lookupsPerClientPerMinute: 2,
      now: () => t,
    });
    const tokens = await Promise.all([mintToken(OWNER), mintToken(OWNER), mintToken(OWNER)]);
    const results = [];
    for (const tok of tokens) results.push(await authorize(req({ authorization: `Bearer ${tok}` }), null));
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(delegation).toHaveBeenCalledTimes(2);
    t += 60_000;
    expect((await authorize(req({ authorization: `Bearer ${tokens[2]}` }), null)).ok).toBe(true);
  });
});

describe("Renown lookups: cached per (app key, wallet), capped only for unknown keys", () => {
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

  async function keyFor(address: string) {
    const crypto = await new RenownCryptoBuilder()
      .withKeyPairStorage(new MemoryKeyStorage())
      .build();
    return { did: crypto.did, mint: () => crypto.getBearerToken(address, { expiresIn: 600, aud: STUDIO }) };
  }

  it("owner polling at 100 req/min, a fresh token each time, stays authorized with one lookup", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    const delegation = jest.fn(async () => true);
    const authorize = authorizer(delegation, { now: () => t });
    for (let i = 0; i < 100; i++) {
      const tok = await owner.mint();
      expect((await authorize(req({ authorization: `Bearer ${tok}` }), null)).ok).toBe(true);
      t += 600;
    }
    expect(delegation).toHaveBeenCalledTimes(1);
  });

  it("a flood of fresh attacker keys claiming the owner can't lock out the owner's verified key", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    const ownerTokens = new Set<string>();
    const delegation = jest.fn(async (jwt: string) => ownerTokens.has(jwt));
    const authorize = authorizer(delegation, { now: () => t });
    const first = await owner.mint();
    ownerTokens.add(first);
    expect((await authorize(req({ authorization: `Bearer ${first}` }), null)).ok).toBe(true);

    // 40 self-signed keys, each claiming the owner's wallet with the right aud.
    for (let i = 0; i < 40; i++) {
      const forged = await (await keyFor(OWNER)).mint();
      expect((await authorize(req({ authorization: `Bearer ${forged}` }), null)).ok).toBe(false);
    }
    // The global cap for unknown keys is spent...
    const lateForger = await (await keyFor(OWNER)).mint();
    const before = delegation.mock.calls.length;
    expect((await authorize(req({ authorization: `Bearer ${lateForger}` }), null)).ok).toBe(false);
    expect(delegation.mock.calls.length).toBe(before);

    // ...yet the owner's key passes, from cache and after its verdict expires.
    const again = await owner.mint();
    ownerTokens.add(again);
    expect((await authorize(req({ authorization: `Bearer ${again}` }), null)).ok).toBe(true);
    t += 6 * 60_000; // owner's verdict expired; attackers spend the new window's cap first
    for (let i = 0; i < 40; i++) {
      await authorize(req({ authorization: `Bearer ${await (await keyFor(OWNER)).mint()}` }), null);
    }
    const later = await owner.mint();
    ownerTokens.add(later);
    expect((await authorize(req({ authorization: `Bearer ${later}` }), null)).ok).toBe(true);
  });

  it("one unknown key gets at most 3 lookups a minute", async () => {
    const t = 1_000_000;
    const attacker = await keyFor(OWNER);
    const delegation = jest.fn(async () => false);
    const authorize = authorizer(delegation, { now: () => t });
    // Failures are cached 30 s per key anyway; the per-key cap is the backstop.
    for (let i = 0; i < 10; i++) {
      await authorize(req({ authorization: `Bearer ${await attacker.mint()}` }), null);
    }
    expect(delegation.mock.calls.length).toBeLessThanOrEqual(3);
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

describe("trusted keys: kept across restarts, per-client lookup shares, evicted on refusal", () => {
  const saved = process.env.ADMINS;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let dir: string;
  let store: string;
  beforeEach(() => {
    process.env.ADMINS = OWNER;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), "vetra-trusted-"));
    store = join(dir, ".ph", "preview-trusted-keys.json");
  });
  afterEach(() => {
    errorSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = saved;
  });

  async function keyFor(address: string) {
    const crypto = await new RenownCryptoBuilder()
      .withKeyPairStorage(new MemoryKeyStorage())
      .build();
    return { did: crypto.did, mint: () => crypto.getBearerToken(address, { expiresIn: 600, aud: STUDIO }) };
  }

  /** A request through the embedded proxy from `client`. */
  function from(client: string, token: string, spoofed?: string): IncomingMessage {
    return req({
      authorization: `Bearer ${token}`,
      "x-forwarded-for": spoofed ? `${spoofed}, ${client}` : client,
    });
  }

  async function flood(authorize: ReturnType<typeof authorizer>, client: string, n: number) {
    for (let i = 0; i < n; i++) {
      const forged = await (await keyFor(OWNER)).mint();
      expect((await authorize(from(client, forged), null)).ok).toBe(false);
    }
  }

  it("a restart keeps the owner's verified key (mode 600, no tokens stored)", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    const ownerTokens = new Set<string>();
    const delegation = jest.fn(async (jwt: string) => ownerTokens.has(jwt));
    const first = await owner.mint();
    ownerTokens.add(first);
    const before = authorizer(delegation, { now: () => t, trustedStorePath: store });
    expect((await before(from("198.51.100.7", first), null)).ok).toBe(true);

    expect(statSync(store).mode & 0o777).toBe(0o600);
    const saved = readFileSync(store, "utf-8");
    expect(saved).toContain(owner.did);
    expect(saved).toContain(OWNER.toLowerCase());
    expect(saved).not.toContain(first);
    expect(saved).not.toMatch(/eyJ/);

    // Restart: a fresh authorizer, attackers from many clients spend the cap.
    t += 6 * 60_000;
    const after = authorizer(delegation, { now: () => t, trustedStorePath: store });
    for (let c = 1; c <= 4; c++) await flood(after, `203.0.113.${c}`, 12);
    const again = await owner.mint();
    ownerTokens.add(again);
    expect(await after(from("198.51.100.7", again), null)).toMatchObject({ ok: true, via: "owner" });
  });

  it("drops stored keys past their trust window, and ignores an unreadable store", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    const ownerTokens = new Set<string>();
    const mint = async () => {
      const tok = await owner.mint();
      ownerTokens.add(tok);
      return tok;
    };
    const delegation = jest.fn(async (jwt: string) => ownerTokens.has(jwt));
    const a = authorizer(delegation, { now: () => t, trustedStorePath: store });
    expect((await a(from("198.51.100.7", await mint()), null)).ok).toBe(true);

    t += 25 * 60 * 60_000;
    const b = authorizer(delegation, { now: () => t, trustedStorePath: store, lookupsPerMinute: 1 });
    await flood(b, "203.0.113.1", 1);
    // Not trusted any more: capped like any unknown key.
    expect((await b(from("198.51.100.7", await mint()), null)).ok).toBe(false);

    writeFileSync(store, "{not json");
    const c = authorizer(delegation, { now: () => t, trustedStorePath: store });
    expect((await c(from("198.51.100.7", await mint()), null)).ok).toBe(true);
  });

  it("one client can't spend the whole lookup cap; spoofed forwarded hops don't add shares", async () => {
    const t = 1_000_000;
    const delegation = jest.fn(async () => false);
    const authorize = authorizer(delegation, { now: () => t });
    for (let i = 0; i < 40; i++) {
      const forged = await (await keyFor(OWNER)).mint();
      await authorize(from("203.0.113.9", forged, `10.0.${i}.1`), null);
    }
    // Default cap 30 a minute, a third of it per client.
    expect(delegation).toHaveBeenCalledTimes(10);

    // The owner's new device, from another client, still gets a lookup.
    const owner = await keyFor(OWNER);
    delegation.mockImplementation(async () => true);
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(true);
  });

  it("a key that fails verification later loses its trust (and the stored entry)", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    let answer: boolean | Error = true;
    const delegation = jest.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const authorize = authorizer(delegation, { now: () => t, trustedStorePath: store, lookupsPerMinute: 3 });
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(true);

    // A lookup that can't run (network) keeps the trust and the last OK
    // verdict, asked again after 30 s...
    t += 6 * 60_000;
    answer = new Error("fetch failed");
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(true);
    const calls = delegation.mock.calls.length;
    t += 10_000;
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(true);
    expect(delegation.mock.calls.length).toBe(calls);
    t += 31_000;
    for (let c = 1; c <= 3; c++) await flood(authorize, `203.0.113.${c}`, 1);
    answer = true;
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(true);

    // ...a refusal evicts it: once the cap is spent the key is capped again.
    t += 6 * 60_000;
    answer = false;
    expect(await authorize(from("198.51.100.7", await owner.mint()), null)).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
    expect(readFileSync(store, "utf-8")).not.toContain(owner.did);
    t += 31_000;
    for (let c = 1; c <= 3; c++) await flood(authorize, `203.0.113.${c}`, 1);
    answer = true;
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(false);
  });
});

describe("lookup shares: IPv6 clients by /64, a reserve for clients new to the window", () => {
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

  async function forged(): Promise<string> {
    const crypto = await new RenownCryptoBuilder().withKeyPairStorage(new MemoryKeyStorage()).build();
    return crypto.getBearerToken(OWNER, { expiresIn: 600, aud: STUDIO });
  }
  const via = (client: string, token: string) =>
    req({ authorization: `Bearer ${token}`, "x-forwarded-for": client });

  it("charges every address of one IPv6 /64 to one client", async () => {
    const t = 1_000_000;
    const delegation = jest.fn(async () => false);
    const authorize = authorizer(delegation, { now: () => t });
    for (let i = 0; i < 15; i++) {
      await authorize(via(`2001:db8:1:2:${i.toString(16)}::${i + 1}`, await forged()), null);
    }
    expect(delegation).toHaveBeenCalledTimes(10);
    await authorize(via("2001:db8:1:3::1", await forged()), null);
    expect(delegation).toHaveBeenCalledTimes(11);
  });

  it("keeps a share of the cap for a client new to the window", async () => {
    const t = 1_000_000;
    const delegation = jest.fn(async () => false);
    const authorize = authorizer(delegation, { now: () => t });
    for (const c of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
      for (let i = 0; i < 12; i++) await authorize(via(c, await forged()), null);
    }
    // 30 a minute, 3 of them kept for clients that haven't asked this window.
    expect(delegation).toHaveBeenCalledTimes(27);
    await authorize(via("203.0.113.3", await forged()), null);
    expect(delegation).toHaveBeenCalledTimes(27);
    // The owner's new device still gets its lookup.
    delegation.mockImplementation(async () => true);
    expect((await authorize(via("198.51.100.7", await forged()), null)).ok).toBe(true);
    expect(delegation).toHaveBeenCalledTimes(28);
  });
});

describe("the default delegation lookup tells 'no credential' from 'couldn't ask'", () => {
  const saved = process.env.ADMINS;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let dir: string;
  let store: string;
  let server: Server;
  let renownUrl: string;
  let mode: "down" | "graphql-down" | "none" | "null" = "down";
  const hits: string[] = [];
  beforeEach(async () => {
    process.env.ADMINS = OWNER;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), "vetra-renown-"));
    store = join(dir, ".ph", "preview-trusted-keys.json");
    hits.length = 0;
    server = createServer((rq, rs) => {
      const p = new URL(rq.url ?? "/", "http://x").pathname;
      hits.push(p);
      const send = (status: number, body?: unknown) => {
        rs.writeHead(status, { "content-type": "application/json" });
        rs.end(body === undefined ? "" : JSON.stringify(body));
      };
      if (p === "/api/switchboard") {
        if (mode === "graphql-down") return send(200, { endpoint: `${renownUrl}/graphql` });
        return send(mode === "down" ? 503 : 404);
      }
      if (p === "/graphql") return send(503);
      if (p === "/api/auth/credential") {
        if (mode === "down") return send(503);
        if (mode === "null") return send(200, { credential: null });
        return send(404);
      }
      send(404);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    renownUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    errorSpy.mockRestore();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.ADMINS;
    else process.env.ADMINS = saved;
  });

  it("Renown down (503, or its switchboard down) keeps a trusted key; no credential evicts it", async () => {
    let t = 1_000_000;
    const crypto = await new RenownCryptoBuilder().withKeyPairStorage(new MemoryKeyStorage()).build();
    const mint = () => crypto.getBearerToken(OWNER, { expiresIn: 600, aud: STUDIO });
    const key = `${crypto.did}|${OWNER.toLowerCase()}`;
    mkdirSync(join(dir, ".ph"), { recursive: true });
    writeFileSync(store, JSON.stringify({ version: 1, keys: { [key]: t } }));
    const authorize = createRequestAuthorizer({
      renownUrl,
      cloud: true,
      audience: () => STUDIO,
      trustedStorePath: store,
      now: () => t,
    });

    mode = "down";
    expect((await authorize(req({ authorization: `Bearer ${await mint()}` }), null)).ok).toBe(true);
    expect(hits).toContain("/api/auth/credential");
    expect(readFileSync(store, "utf-8")).toContain(key);

    t += 31_000;
    mode = "graphql-down";
    hits.length = 0;
    expect((await authorize(req({ authorization: `Bearer ${await mint()}` }), null)).ok).toBe(true);
    expect(hits).toContain("/graphql");
    expect(readFileSync(store, "utf-8")).toContain(key);

    t += 31_000;
    mode = "none";
    expect(await authorize(req({ authorization: `Bearer ${await mint()}` }), null)).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
    expect(readFileSync(store, "utf-8")).not.toContain(key);
  });

  it("an unknown key with no credential (null) is refused", async () => {
    mode = "null";
    const crypto = await new RenownCryptoBuilder().withKeyPairStorage(new MemoryKeyStorage()).build();
    const authorize = createRequestAuthorizer({ renownUrl, cloud: true, audience: () => STUDIO });
    const tok = await crypto.getBearerToken(OWNER, { expiresIn: 600, aud: STUDIO });
    expect((await authorize(req({ authorization: `Bearer ${tok}` }), null)).ok).toBe(false);
    expect(hits).toContain("/api/auth/credential");
  });
});
