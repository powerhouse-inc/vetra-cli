import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCredentialRecords, withdrawCredentialRecords } from "@powerhousedao/shared/clis/credential-records";
import { MemoryKeyStorage, RenownCryptoBuilder } from "@renown/sdk/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRequestAuthorizer,
  isLocalRequest,
  type BearerClaims,
} from "../../src/preview-server/request-auth.js";

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

async function keyFor(address: string) {
  const crypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(new MemoryKeyStorage())
    .build();
  return { did: crypto.did, mint: () => crypto.getBearerToken(address, { expiresIn: 600, aud: STUDIO }) };
}

function authorizer(verifyCredential: (claims: BearerClaims) => Promise<boolean>, extra = {}) {
  return createRequestAuthorizer({
    renownUrl: "http://renown.invalid",
    dataDir: join(tmpdir(), "vetra-request-auth-unused"),
    cloud: true,
    audience: () => `${STUDIO}/preview`,
    verifyCredential,
    ...extra,
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("ADMINS", OWNER);
  vi.stubEnv("VETRA_SESSION_EXPORT_SECRET", undefined);
  // The SDK logs every rejected token; keep the run quiet.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("createRequestAuthorizer with the real token check", () => {
  it("a self-signed token claiming the owner's wallet is refused without its credential", async () => {
    // Anyone can mint this: a fresh did:key signing a claim to OWNER's address.
    const forger = await keyFor(OWNER);
    const verifyCredential = vi.fn(async () => false);
    const authorize = authorizer(verifyCredential);
    const check = await authorize(req({ authorization: `Bearer ${await forger.mint()}` }), null);
    expect(check).toMatchObject({ ok: false, status: 401 });
    expect(verifyCredential).toHaveBeenCalledWith(
      expect.objectContaining({ address: OWNER, appDid: forger.did, chainId: 1, networkId: "eip155" }),
    );
  });

  it("accepts the owner's token while its credential holds, asking at every request", async () => {
    const token = await mintToken(OWNER);
    let holds = true;
    const verifyCredential = vi.fn(async () => holds);
    const authorize = authorizer(verifyCredential);
    const r = req({ authorization: `Bearer ${token}` });
    expect(await authorize(r, null)).toMatchObject({ ok: true, via: "owner" });
    expect(await authorize(r, null)).toMatchObject({ ok: true, via: "owner" });
    expect(verifyCredential).toHaveBeenCalledTimes(2);
    // Withdrawn: the very next request is refused.
    holds = false;
    expect(await authorize(r, null)).toMatchObject({ ok: false, status: 401 });
  });

  it("a verified token for another wallet is the same 401, and costs no check", async () => {
    const token = await mintToken("0x00000000000000000000000000000000000000bb");
    const verifyCredential = vi.fn(async () => true);
    const authorize = authorizer(verifyCredential);
    expect(await authorize(req({ authorization: `Bearer ${token}` }), null)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyCredential).not.toHaveBeenCalled();
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

  it("a check that cannot run refuses now and is asked again on the next request", async () => {
    const token = await mintToken(OWNER);
    let down = true;
    const verifyCredential = vi.fn(async () => {
      if (down) throw new Error("fetch failed");
      return true;
    });
    const authorize = authorizer(verifyCredential);
    const r = req({ authorization: `Bearer ${token}` });
    expect((await authorize(r, null)).ok).toBe(false);
    down = false;
    expect((await authorize(r, null)).ok).toBe(true);
    expect(verifyCredential).toHaveBeenCalledTimes(2);
  });
});

describe("bearer is bound to this Studio (aud)", () => {
  it("refuses a token minted for another Studio, or with no aud at all", async () => {
    const verifyCredential = vi.fn(async () => true);
    const authorize = authorizer(verifyCredential);
    const other = await mintToken(OWNER, { aud: "https://evil-studio.vetra.example" });
    const none = await mintToken(OWNER, { aud: null });
    for (const t of [other, none]) {
      expect(await authorize(req({ authorization: `Bearer ${t}` }), null)).toMatchObject({
        ok: false,
        status: 401,
      });
    }
    expect(verifyCredential).not.toHaveBeenCalled();
    const mine = await mintToken(OWNER);
    expect(await authorize(req({ authorization: `Bearer ${mine}` }), null)).toMatchObject({
      ok: true,
    });
  });

  it("caps checks per minute; a flood of fresh keys is refused", async () => {
    let t = 1_000_000;
    const verifyCredential = vi.fn(async () => true);
    const authorize = authorizer(verifyCredential, {
      lookupsPerMinute: 2,
      lookupsPerClientPerMinute: 2,
      now: () => t,
    });
    const tokens = await Promise.all([mintToken(OWNER), mintToken(OWNER), mintToken(OWNER)]);
    const results = [];
    for (const tok of tokens) results.push(await authorize(req({ authorization: `Bearer ${tok}` }), null));
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(verifyCredential).toHaveBeenCalledTimes(2);
    t += 60_000;
    expect((await authorize(req({ authorization: `Bearer ${tokens[2]}` }), null)).ok).toBe(true);
  });
});

describe("checks are capped only for keys that have not verified", () => {
  /** A request through the embedded proxy from `client`. */
  function from(client: string, token: string, spoofed?: string): IncomingMessage {
    return req({
      authorization: `Bearer ${token}`,
      "x-forwarded-for": spoofed ? `${spoofed}, ${client}` : client,
    });
  }

  it("the owner polling at 100 req/min with a fresh token each time stays authorized", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    const verifyCredential = vi.fn(async () => true);
    const authorize = authorizer(verifyCredential, { now: () => t, lookupsPerMinute: 3 });
    for (let i = 0; i < 100; i++) {
      expect((await authorize(req({ authorization: `Bearer ${await owner.mint()}` }), null)).ok).toBe(true);
      t += 600;
    }
  });

  it("a flood of fresh attacker keys claiming the owner can't lock out the owner's verified key", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    const verifyCredential = vi.fn(async (claims: BearerClaims) => claims.appDid === owner.did);
    const authorize = authorizer(verifyCredential, { now: () => t });
    expect((await authorize(req({ authorization: `Bearer ${await owner.mint()}` }), null)).ok).toBe(true);

    // 40 self-signed keys, each claiming the owner's wallet with the right aud.
    for (let i = 0; i < 40; i++) {
      const forged = await (await keyFor(OWNER)).mint();
      expect((await authorize(req({ authorization: `Bearer ${forged}` }), null)).ok).toBe(false);
    }
    // The cap for unknown keys is spent...
    const before = verifyCredential.mock.calls.length;
    const late = await (await keyFor(OWNER)).mint();
    expect((await authorize(req({ authorization: `Bearer ${late}` }), null)).ok).toBe(false);
    expect(verifyCredential.mock.calls.length).toBe(before);
    // ...yet the owner's key passes, now and later.
    expect((await authorize(req({ authorization: `Bearer ${await owner.mint()}` }), null)).ok).toBe(true);
    t += 6 * 60_000;
    expect((await authorize(req({ authorization: `Bearer ${await owner.mint()}` }), null)).ok).toBe(true);
  });

  it("one unknown key gets at most 3 checks a minute", async () => {
    const t = 1_000_000;
    const attacker = await keyFor(OWNER);
    const verifyCredential = vi.fn(async () => false);
    const authorize = authorizer(verifyCredential, { now: () => t });
    // Refusals are kept 30 s per key anyway; the per-key cap is the backstop.
    for (let i = 0; i < 10; i++) {
      await authorize(req({ authorization: `Bearer ${await attacker.mint()}` }), null);
    }
    expect(verifyCredential.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("one client can't spend the whole cap; spoofed forwarded hops don't add shares", async () => {
    const t = 1_000_000;
    const verifyCredential = vi.fn(async () => false);
    const authorize = authorizer(verifyCredential, { now: () => t });
    for (let i = 0; i < 40; i++) {
      const forged = await (await keyFor(OWNER)).mint();
      await authorize(from("203.0.113.9", forged, `10.0.${i}.1`), null);
    }
    // Default cap 30 a minute, a third of it per client.
    expect(verifyCredential).toHaveBeenCalledTimes(10);
    // The owner's new device, from another client, still gets a check.
    verifyCredential.mockImplementation(async () => true);
    expect((await authorize(from("198.51.100.7", await (await keyFor(OWNER)).mint()), null)).ok).toBe(true);
  });

  it("a key whose credential no longer holds loses its trust", async () => {
    let t = 1_000_000;
    const owner = await keyFor(OWNER);
    let holds = true;
    const verifyCredential = vi.fn(async () => holds);
    const authorize = authorizer(verifyCredential, { now: () => t, lookupsPerMinute: 3 });
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(true);
    holds = false;
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(false);
    // Capped like any unknown key once the cap is spent.
    t += 31_000;
    for (let c = 1; c <= 3; c++) {
      await authorize(from(`203.0.113.${c}`, await (await keyFor(OWNER)).mint()), null);
    }
    holds = true;
    expect((await authorize(from("198.51.100.7", await owner.mint()), null)).ok).toBe(false);
  });
});

describe("check shares: IPv6 clients by /64, a reserve for clients new to the window", () => {
  const via = (client: string, token: string) =>
    req({ authorization: `Bearer ${token}`, "x-forwarded-for": client });

  it("charges every address of one IPv6 /64 to one client", async () => {
    const t = 1_000_000;
    const verifyCredential = vi.fn(async () => false);
    const authorize = authorizer(verifyCredential, { now: () => t });
    for (let i = 0; i < 15; i++) {
      await authorize(via(`2001:db8:1:2:${i.toString(16)}::${i + 1}`, await mintToken(OWNER)), null);
    }
    expect(verifyCredential).toHaveBeenCalledTimes(10);
    await authorize(via("2001:db8:1:3::1", await mintToken(OWNER)), null);
    expect(verifyCredential).toHaveBeenCalledTimes(11);
  });

  it("keeps a share of the cap for a client new to the window", async () => {
    const t = 1_000_000;
    const verifyCredential = vi.fn(async () => false);
    const authorize = authorizer(verifyCredential, { now: () => t });
    for (const c of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
      for (let i = 0; i < 12; i++) await authorize(via(c, await mintToken(OWNER)), null);
    }
    // 30 a minute, 3 of them kept for clients that haven't asked this window.
    expect(verifyCredential).toHaveBeenCalledTimes(27);
    await authorize(via("203.0.113.3", await mintToken(OWNER)), null);
    expect(verifyCredential).toHaveBeenCalledTimes(27);
    // The owner's new device still gets its check.
    verifyCredential.mockImplementation(async () => true);
    expect((await authorize(via("198.51.100.7", await mintToken(OWNER)), null)).ok).toBe(true);
    expect(verifyCredential).toHaveBeenCalledTimes(28);
  });
});

describe("the hosts' check over the store's data folder", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vetra-request-auth-"));
    vi.stubEnv("PH_IDENTITY_HOME", join(root, "identities"));
    vi.stubEnv("PH_USER_DATA_DIR", undefined);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("accepts a credential the store holds a record of, and refuses it once withdrawn", async () => {
    const dataDir = join(root, "studio");
    const { openSession } = await import("@renown/sdk/identity");
    // A pseudonym's session, its record in the store; Renown is never asked.
    const session = await openSession({
      dataDir,
      label: "connect test",
      place: "data-folder",
      interactive: false,
      target: { dataDir },
    });
    vi.stubEnv("ADMINS", session.signer.user.address);
    const authorize = createRequestAuthorizer({
      renownUrl: "http://127.0.0.1:1",
      dataDir,
      cloud: true,
      audience: () => STUDIO,
    });
    const bearer = await session.bearer({ aud: STUDIO });
    expect(await authorize(req({ authorization: `Bearer ${bearer}` }), null)).toMatchObject({
      ok: true,
      via: "owner",
      address: session.signer.user.address,
    });

    const [record] = listCredentialRecords({ dataDir });
    withdrawCredentialRecords({ dataDir, ids: [record!.id], by: "command" });
    expect(await authorize(req({ authorization: `Bearer ${bearer}` }), null)).toMatchObject({
      ok: false,
      status: 401,
    });
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
