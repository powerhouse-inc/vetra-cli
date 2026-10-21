/**
 * Wallet -> app-key delegations, checked on the Studio's Renown (P6-2).
 *
 * Security-sensitive: a credential that is missing, expired, for another
 * subject/issuer or wrongly signed is a refusal; a Renown failure throws
 * `DelegationUnavailableError` so the caller (the trust ledger) refuses this
 * call but does NOT record a permanent verdict. Verdicts are cached 5 min ok /
 * 30 s refused, and lookups for keys not recently verified are capped like the
 * preview-server gate (30/min overall, 3/min per key), so a flood of unknown
 * keys cannot lock out a key that already verified.
 */
import {
  fetchDelegationCredential,
  verifyCredentialSignature,
  type PowerhouseVerifiableCredential,
} from "@renown/sdk/node";

export const DELEGATION_OK_TTL_MS = 5 * 60_000;
export const DELEGATION_REFUSED_TTL_MS = 30_000;
/** A key verified within this long re-checks without the lookup caps. */
const TRUSTED_MS = 24 * 60 * 60_000;
const WINDOW_MS = 60_000;
const CACHE_MAX = 500;

export class DelegationUnavailableError extends Error {
  override name = "DelegationUnavailableError";
}

/** True when `address` delegated to `appKey`; throws when Renown cannot answer. */
export type DelegationCheck = (address: string, appKey: string) => Promise<boolean>;

export interface DelegationCheckOptions {
  /** The Studio's Renown; undefined = the SDK default. */
  renownUrl?: string;
  /** Chain of the wallet's `did:pkh` issuer (default 1). */
  chainId?: number;
  now?: () => number;
  /** Seam for tests: read the credential for (address, appKey). */
  fetchCredential?: (
    address: string,
    appKey: string,
  ) => Promise<PowerhouseVerifiableCredential | undefined>;
  /** Seam for tests; default: the SDK's EIP-712 proof check. */
  verifyProof?: (credential: PowerhouseVerifiableCredential) => Promise<boolean>;
  lookupsPerMinute?: number;
  lookupsPerKeyPerMinute?: number;
}

/** Insert into a bounded map, dropping the oldest entries when full. */
function boundedSet<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  while (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
  map.set(key, value);
}

function pkhDid(address: string, chainId: number): string {
  return `did:pkh:eip155:${chainId}:${address.toLowerCase()}`;
}

export function createDelegationCheck(opts: DelegationCheckOptions = {}): DelegationCheck {
  const now = opts.now ?? Date.now;
  const chainId = opts.chainId ?? 1;
  const fetchCredential =
    opts.fetchCredential ??
    ((address: string, appKey: string) =>
      fetchDelegationCredential({
        address,
        chainId,
        appDid: appKey,
        baseUrl: opts.renownUrl,
        // The binding and proof are checked below, once, for both paths.
        verifySignature: false,
      }));
  const verifyProof = opts.verifyProof ?? verifyCredentialSignature;
  const lookupsPerMinute = opts.lookupsPerMinute ?? 30;
  const lookupsPerKeyPerMinute = opts.lookupsPerKeyPerMinute ?? 3;

  const verdicts = new Map<string, { ok: boolean; until: number }>();
  const inFlight = new Map<string, Promise<boolean>>();
  const trusted = new Map<string, number>();
  const perKey = new Map<string, { start: number; count: number }>();
  let windowStart = 0;
  let unknownLookups = 0;

  function allowUnknownLookup(key: string, t: number): boolean {
    if (t - windowStart >= WINDOW_MS) {
      windowStart = t;
      unknownLookups = 0;
    }
    let k = perKey.get(key);
    if (!k || t - k.start >= WINDOW_MS) {
      k = { start: t, count: 0 };
      boundedSet(perKey, key, k);
    }
    if (k.count >= lookupsPerKeyPerMinute || unknownLookups >= lookupsPerMinute) {
      return false;
    }
    k.count++;
    unknownLookups++;
    return true;
  }

  /** Binding, expiry and proof of a credential Renown returned for this pair. */
  async function valid(
    credential: PowerhouseVerifiableCredential,
    address: string,
    appKey: string,
  ): Promise<boolean> {
    const subject = credential.credentialSubject as { id?: unknown } | undefined;
    if (subject?.id !== appKey) return false;
    const issuer = credential.issuer as { id?: unknown } | undefined;
    if (typeof issuer?.id !== "string" || issuer.id.toLowerCase() !== pkhDid(address, chainId)) {
      return false;
    }
    const expires = credential.expirationDate ? Date.parse(credential.expirationDate) : Number.NaN;
    if (!Number.isFinite(expires) || expires <= now()) return false;
    try {
      return await verifyProof(credential);
    } catch {
      return false;
    }
  }

  async function lookup(address: string, appKey: string): Promise<boolean> {
    const credential = await fetchCredential(address, appKey);
    if (!credential) return false;
    return valid(credential, address, appKey);
  }

  return async (address, appKey) => {
    const addr = address.toLowerCase();
    const key = `${appKey}|${addr}`;
    const t = now();
    const hit = verdicts.get(key);
    if (hit && hit.until > t) return hit.ok;
    const running = inFlight.get(key);
    if (running) return running;

    const lastOk = trusted.get(key);
    const isTrusted = lastOk !== undefined && t - lastOk < TRUSTED_MS;
    if (!isTrusted && !allowUnknownLookup(key, t)) {
      // Temporary, never a verdict: the trust ledger must not record it.
      throw new DelegationUnavailableError("delegation lookups are capped; try again shortly");
    }
    const pending = (async () => {
      let ok: boolean;
      try {
        ok = await lookup(addr, appKey);
      } catch (err) {
        // Renown could not answer: no verdict (the caller fails closed now and
        // retries later).
        throw new DelegationUnavailableError(
          `delegation lookup failed: ${err instanceof Error ? err.name : "unknown error"}`,
        );
      }
      const done = now();
      boundedSet(verdicts, key, {
        ok,
        until: done + (ok ? DELEGATION_OK_TTL_MS : DELEGATION_REFUSED_TTL_MS),
      });
      if (ok) boundedSet(trusted, key, done);
      return ok;
    })();
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(key);
    }
  };
}
