/**
 * Per-request owner gate for the preview server. See ARCHITECTURE.md →
 * "Preview-server access gate".
 *
 * Authorizes the *sender of the request*, never the daemon's own Renown
 * sign-in. A request passes when it carries one of:
 *   1. the operator secret (`VETRA_SESSION_EXPORT_SECRET`) as
 *      `Authorization: Bearer <secret>` or `?token=` (constant-time compare);
 *   2. a Renown bearer token minted for *this* Studio — `aud` must equal the
 *      Studio's public origin (so a token captured by another Studio the owner
 *      opens can't be replayed here) — that verifies: JWT signature + expiry,
 *      then the wallet→app delegation credential on Renown, for a wallet in
 *      the pod's `ADMINS`;
 *   3. local mode only (no studio environment id, no `ADMINS`, no secret):
 *      a direct-loopback request with a loopback Host and browser origin.
 * A cloud Studio (environment id or `ADMINS` set) never takes path 3; with
 * `ADMINS` unset, or no known public origin, it refuses every bearer (fail
 * closed). Every bearer refusal is the same 401, so the gate is no oracle for
 * which wallet is the owner.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { verifyAuthBearerToken, verifyAuthCredential } from "@renown/sdk/node";
import { isAdminAddress } from "../auth/renown.js";

export type OwnerCheck =
  | { ok: true; via: "operator" | "owner" | "local"; address?: string }
  | { ok: false; status: 401; error: string };

/** A verified bearer's claimed identity (signature, expiry, `aud` checked). */
export interface BearerClaims {
  address: string;
  appDid: string;
}

export interface RequestAuthOptions {
  /** The Renown the Studio's Connect logs in on (`resolveStudioRenownUrl`);
   *  undefined = the SDK default. */
  renownUrl: string | undefined;
  /** Running as a cloud Studio (`config.environmentId` set). */
  cloud: boolean;
  /** This Studio's public origin (the required `aud`), read per request;
   *  undefined = not known yet, every bearer is refused. */
  audience: () => string | undefined;
  /** Local JWT check (signature + expiry + `aud`). Default: `@renown/sdk`. */
  verifyBearer?: (jwt: string, audience: string) => Promise<BearerClaims | false>;
  /** Network check that the wallet delegated to the token's app key. */
  verifyDelegation?: (jwt: string, audience: string) => Promise<boolean>;
  /** Max Renown delegation lookups per minute (default 30). */
  lookupsPerMinute?: number;
  now?: () => number;
}

export type RequestAuthorizer = (
  req: IncomingMessage,
  queryToken: string | null,
) => Promise<OwnerCheck>;

function sha256Eq(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.trim().toLowerCase();
  return (
    a === "::1" ||
    a === "[::1]" ||
    a === "localhost" ||
    /^127\.\d+\.\d+\.\d+$/.test(a) ||
    /^::ffff:127\.\d+\.\d+\.\d+$/.test(a)
  );
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackAddress(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v.join(",") : v;
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return isLoopbackAddress(new URL(`http://${host.trim()}`).hostname);
  } catch {
    return false;
  }
}

/**
 * The request comes from this machine: a loopback socket, every
 * `x-forwarded-for` hop loopback (the embedded proxy listens on 0.0.0.0 and
 * appends the real client address, so a LAN or ingress hop shows up here), a
 * loopback Host (the proxy rewrites Host, so through it the browser's Host is
 * `x-forwarded-host`), and no cross-site browser origin. Host + Origin block
 * DNS rebinding (a same-origin GET carries no Origin, but its Host is the
 * attacker's name).
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  const xff = headerValue(req, "x-forwarded-for");
  if (xff !== undefined && !xff.split(",").every((h) => isLoopbackAddress(h))) {
    return false;
  }
  if (!isLoopbackHost(headerValue(req, "host"))) return false;
  const xfh = headerValue(req, "x-forwarded-host");
  if (xfh !== undefined && !xfh.split(",").every((h) => isLoopbackHost(h))) {
    return false;
  }
  const origin = headerValue(req, "origin");
  return origin === undefined || isLoopbackOrigin(origin);
}

/** `https://host/x/y` → `https://host`; undefined when not a URL. */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const o = new URL(url).origin;
    return o === "null" ? undefined : o;
  } catch {
    return undefined;
  }
}

function bearerOf(req: IncomingMessage): string | undefined {
  const auth = headerValue(req, "authorization");
  if (!auth) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : undefined;
}

// did-jwt only checks `aud` when the token carries one, so require it here:
// a token without `aud` (e.g. one minted for the switchboard) never passes.
function audMatches(aud: unknown, audience: string): boolean {
  const list = Array.isArray(aud) ? aud : [aud];
  return list.length === 1 && list[0] === audience;
}

async function defaultVerifyBearer(
  jwt: string,
  audience: string,
): Promise<BearerClaims | false> {
  const verified = await verifyAuthBearerToken(jwt, { audience });
  if (!verified) return false;
  if (!audMatches(verified.payload.aud, audience)) return false;
  const address = verified.verifiableCredential.credentialSubject.address;
  const appDid = verified.issuer;
  if (typeof address !== "string" || !address || !appDid) return false;
  return { address, appDid };
}

const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 30_000;
const CACHE_MAX = 500;

export function createRequestAuthorizer(opts: RequestAuthOptions): RequestAuthorizer {
  const now = opts.now ?? Date.now;
  const verifyBearer = opts.verifyBearer ?? defaultVerifyBearer;
  const verifyDelegation =
    opts.verifyDelegation ??
    (async (jwt: string, audience: string) =>
      (await verifyAuthCredential(jwt, { audience, renownUrl: opts.renownUrl })) !==
      undefined);
  const lookupsPerMinute = opts.lookupsPerMinute ?? 30;
  // Delegation verdicts per token (the network round-trip), bounded.
  const delegationCache = new Map<string, { ok: boolean; until: number }>();
  let windowStart = 0;
  let lookupsInWindow = 0;

  async function delegated(jwt: string, audience: string): Promise<boolean> {
    const key = createHash("sha256").update(jwt).digest("hex");
    const t = now();
    const hit = delegationCache.get(key);
    if (hit && hit.until > t) return hit.ok;
    // Fixed-window cap on Renown round-trips: a flood of fresh tokens is
    // refused (not cached) rather than amplified into Renown traffic.
    if (t - windowStart >= 60_000) {
      windowStart = t;
      lookupsInWindow = 0;
    }
    if (lookupsInWindow >= lookupsPerMinute) return false;
    lookupsInWindow++;
    let ok = false;
    try {
      ok = await verifyDelegation(jwt, audience);
    } catch {
      ok = false;
    }
    if (delegationCache.size >= CACHE_MAX) {
      for (const [k, v] of delegationCache) if (v.until <= t) delegationCache.delete(k);
      while (delegationCache.size >= CACHE_MAX) {
        const first = delegationCache.keys().next().value;
        if (first === undefined) break;
        delegationCache.delete(first);
      }
    }
    delegationCache.set(key, { ok, until: t + (ok ? OK_TTL_MS : FAIL_TTL_MS) });
    return ok;
  }

  return async (req, queryToken) => {
    const secret = process.env.VETRA_SESSION_EXPORT_SECRET;
    const admins = process.env.ADMINS;
    const bearer = bearerOf(req);

    if (secret) {
      const provided = bearer ?? queryToken ?? "";
      if (provided.length > 0 && sha256Eq(provided, secret)) {
        return { ok: true, via: "operator" };
      }
    }

    const hasAdmins = (admins ?? "").trim().length > 0;
    const localMode = !opts.cloud && !hasAdmins && !secret;
    if (localMode && isLocalRequest(req)) return { ok: true, via: "local" };

    const refused = { ok: false, status: 401, error: "unauthorized" } as const;
    if (!bearer) return refused;
    // Fail closed: no owner configured means nobody is the owner, and no known
    // public origin means no token can be bound to this Studio.
    const audience = originOf(opts.audience());
    if (!hasAdmins || !audience) return refused;

    let claims: BearerClaims | false = false;
    try {
      claims = await verifyBearer(bearer, audience);
    } catch {
      claims = false;
    }
    if (!claims) return refused;
    // Address check before the network one: a non-owner never costs a lookup.
    if (!isAdminAddress(claims.address, admins)) return refused;
    if (!(await delegated(bearer, audience))) return refused;
    return { ok: true, via: "owner", address: claims.address };
  };
}
