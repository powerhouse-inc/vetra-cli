import { describe, expect, it, jest } from "@jest/globals";
import type { PowerhouseVerifiableCredential } from "@renown/sdk/node";

import {
  createDelegationCheck,
  DelegationUnavailableError,
  DELEGATION_OK_TTL_MS,
  DELEGATION_REFUSED_TTL_MS,
} from "../../src/team/delegation-check.js";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const OWNER = "0x1111111111111111111111111111111111111111";
const APP = "did:key:z6MkApp";

function credential(over: { subject?: string; issuer?: string; expires?: string } = {}) {
  return {
    credentialSubject: { id: over.subject ?? APP },
    issuer: { id: over.issuer ?? `did:pkh:eip155:1:${OWNER}` },
    expirationDate: over.expires ?? new Date(NOW + 60 * 60_000).toISOString(),
  } as unknown as PowerhouseVerifiableCredential;
}

function setup(over: Parameters<typeof credential>[0] = {}) {
  const clock = { t: NOW };
  const fetchCredential = jest.fn(async () => credential(over));
  const check = createDelegationCheck({
    now: () => clock.t,
    fetchCredential,
    verifyProof: async () => true,
  });
  return { check, fetchCredential, clock };
}

describe("delegation check", () => {
  it("accepts a matching, unexpired, correctly signed delegation", async () => {
    const { check, fetchCredential } = setup();
    expect(await check(OWNER, APP)).toBe(true);
    expect(fetchCredential).toHaveBeenCalledWith(OWNER, APP);
  });

  it("caches an accepted verdict for 5 minutes", async () => {
    const { check, fetchCredential, clock } = setup();
    await check(OWNER, APP);
    clock.t += DELEGATION_OK_TTL_MS - 1000;
    expect(await check(OWNER, APP)).toBe(true);
    expect(fetchCredential).toHaveBeenCalledTimes(1);
    clock.t += 2000;
    expect(await check(OWNER, APP)).toBe(true);
    expect(fetchCredential).toHaveBeenCalledTimes(2);
  });

  it("caches a refusal for 30 seconds only", async () => {
    const clock = { t: NOW };
    const fetchCredential = jest.fn(async () => undefined);
    const check = createDelegationCheck({ now: () => clock.t, fetchCredential, verifyProof: async () => true });
    expect(await check(OWNER, APP)).toBe(false);
    clock.t += DELEGATION_REFUSED_TTL_MS - 1000;
    expect(await check(OWNER, APP)).toBe(false);
    expect(fetchCredential).toHaveBeenCalledTimes(1);
    clock.t += 2000;
    expect(await check(OWNER, APP)).toBe(false);
    expect(fetchCredential).toHaveBeenCalledTimes(2);
  });

  it("refuses another subject, another issuer, an expired credential and a bad proof", async () => {
    const now = Date.parse("2026-10-21T12:00:00.000Z");
    const run = async (
      over: Parameters<typeof credential>[0],
      proof = true,
      expiresCheck = NOW,
    ) => {
      const check = createDelegationCheck({
        now: () => expiresCheck,
        fetchCredential: async () => credential(over),
        verifyProof: async () => proof,
      });
      return check(OWNER, APP);
    };
    expect(await run({ subject: "did:key:zOther" })).toBe(false);
    expect(await run({ issuer: `did:pkh:eip155:1:0x2222222222222222222222222222222222222222` })).toBe(false);
    expect(await run({ expires: new Date(now - 1000).toISOString() })).toBe(false);
    expect(await run({}, false)).toBe(false);
    const noExpiry = createDelegationCheck({
      now: () => now,
      fetchCredential: async () =>
        ({
          credentialSubject: { id: APP },
          issuer: { id: `did:pkh:eip155:1:${OWNER}` },
        }) as unknown as PowerhouseVerifiableCredential,
      verifyProof: async () => true,
    });
    expect(await noExpiry(OWNER, APP)).toBe(false);
  });

  it("throws (and records nothing) when Renown cannot answer", async () => {
    const clock = { t: NOW };
    const fetchCredential = jest
      .fn<() => Promise<PowerhouseVerifiableCredential | undefined>>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(credential());
    const check = createDelegationCheck({ now: () => clock.t, fetchCredential, verifyProof: async () => true });
    await expect(check(OWNER, APP)).rejects.toBeInstanceOf(DelegationUnavailableError);
    // Not cached as a refusal: the retry succeeds immediately.
    expect(await check(OWNER, APP)).toBe(true);
  });

  it("caps lookups for unknown keys without caching a refusal", async () => {
    const check = createDelegationCheck({
      now: () => NOW,
      fetchCredential: async () => undefined,
      verifyProof: async () => true,
      lookupsPerMinute: 1,
      lookupsPerKeyPerMinute: 1,
    });
    expect(await check(OWNER, APP)).toBe(false); // one allowed lookup, cached refusal
    await expect(check(OWNER, "did:key:zOther")).rejects.toBeInstanceOf(DelegationUnavailableError);
  });
});
