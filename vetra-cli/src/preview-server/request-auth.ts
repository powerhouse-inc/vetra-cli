/**
 * Per-request owner gate for the preview server. See ARCHITECTURE.md →
 * "Preview-server access gate".
 *
 * Authorizes the *sender of the request*, never the daemon's own Renown
 * sign-in. A request passes when it carries one of:
 *   1. the operator secret (`VETRA_SESSION_EXPORT_SECRET`) as
 *      `Authorization: Bearer <secret>` or `?token=` (constant-time compare);
 *   2. a Renown bearer token (the kind Connect sends to the switchboard) that
 *      verifies — JWT signature + expiry, then the wallet→app delegation
 *      credential on Renown — and whose wallet is in the pod's `ADMINS`;
 *   3. local mode only (no studio environment id, no `ADMINS`, no secret):
 *      a direct-loopback request from a loopback browser origin.
 * A cloud Studio (environment id or `ADMINS` set) never takes path 3; with
 * `ADMINS` unset it refuses every bearer (fail closed).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { verifyAuthBearerToken, verifyAuthCredential } from "@renown/sdk/node";
import { isAdminAddress } from "../auth/renown.js";

export type OwnerCheck =
  | { ok: true; via: "operator" | "owner" | "local"; address?: string }
  | { ok: false; status: 401 | 403; error: string };

/** A verified bearer's claimed identity (signature + expiry checked). */
export interface BearerClaims {
  address: string;
  appDid: string;
}

export interface RequestAuthOptions {
  renownUrl: string;
  /** Running as a cloud Studio (`config.environmentId` set). */
  cloud: boolean;
  /** Local JWT check (signature + expiry). Default: `@renown/sdk`. */
  verifyBearer?: (jwt: string) => Promise<BearerClaims | false>;
  /** Network check that the wallet delegated to the token's app key. */
  verifyDelegation?: (jwt: string) => Promise<boolean>;
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

/**
 * The request comes from this machine: a loopback socket, every
 * `x-forwarded-for` hop loopback (the embedded proxy listens on 0.0.0.0 and
 * appends the real client address, so a LAN or ingress hop shows up here), and
 * no cross-site browser origin (blocks a malicious page / DNS rebinding).
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  const xff = headerValue(req, "x-forwarded-for");
  if (xff !== undefined && !xff.split(",").every((h) => isLoopbackAddress(h))) {
    return false;
  }
  const origin = headerValue(req, "origin");
  return origin === undefined || isLoopbackOrigin(origin);
}

function bearerOf(req: IncomingMessage): string | undefined {
  const auth = headerValue(req, "authorization");
  if (!auth) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : undefined;
}

async function defaultVerifyBearer(jwt: string): Promise<BearerClaims | false> {
  const verified = await verifyAuthBearerToken(jwt);
  if (!verified) return false;
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
    (async (jwt: string) =>
      (await verifyAuthCredential(jwt, { renownUrl: opts.renownUrl })) !== undefined);
  // Delegation verdicts per token (the network round-trip), bounded.
  const delegationCache = new Map<string, { ok: boolean; until: number }>();

  async function delegated(jwt: string): Promise<boolean> {
    const key = createHash("sha256").update(jwt).digest("hex");
    const t = now();
    const hit = delegationCache.get(key);
    if (hit && hit.until > t) return hit.ok;
    let ok = false;
    try {
      ok = await verifyDelegation(jwt);
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

    if (!bearer) return { ok: false, status: 401, error: "unauthorized" };

    let claims: BearerClaims | false = false;
    try {
      claims = await verifyBearer(bearer);
    } catch {
      claims = false;
    }
    if (!claims) return { ok: false, status: 401, error: "invalid-token" };

    // Fail closed: no owner configured means nobody is the owner.
    if (!hasAdmins) return { ok: false, status: 403, error: "no-owner-configured" };
    // Address check before the network one: a non-owner never costs a lookup.
    if (!isAdminAddress(claims.address, admins)) {
      return { ok: false, status: 403, error: "forbidden" };
    }
    if (!(await delegated(bearer))) {
      return { ok: false, status: 401, error: "invalid-credential" };
    }
    return { ok: true, via: "owner", address: claims.address };
  };
}
