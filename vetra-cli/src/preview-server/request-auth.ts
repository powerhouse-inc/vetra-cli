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
import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyAuthBearerToken, verifyAuthCredential } from "@renown/sdk/node";
import { isAdminAddress } from "../auth/renown.js";
import {
  CAPABILITIES,
  type Capability,
  type CapabilityContext,
  type Member,
} from "../team/roles.js";

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
  /** Max Renown lookups per minute for not-yet-verified app keys, overall
   *  (default 30). Recently verified keys are never capped. */
  lookupsPerMinute?: number;
  /** Max lookups per minute for one not-yet-verified app key (default 3). */
  lookupsPerKeyPerMinute?: number;
  now?: () => number;
}

export type RequestAuthorizer = (
  req: IncomingMessage,
  queryToken: string | null,
) => Promise<OwnerCheck>;

/**
 * The member gate's verdict. `member` is null for the operator secret and
 * local mode (admin-side paths, not people); `access-unavailable` means Renown
 * could not answer and the request is refused (the UI's "try again" message).
 */
export type MemberCheck =
  | { ok: true; via: "operator" | "member" | "local"; member: Member | null }
  | { ok: false; status: 401 | 403; error: string };

export type MemberAuthorizer = (
  req: IncomingMessage,
  queryToken: string | null,
) => Promise<MemberCheck>;

export interface MemberAuthOptions extends RequestAuthOptions {
  /** Who is a member of *this* Studio, in which role (team/membership.ts). */
  membership: { resolve(address: string): Promise<Member | null> };
  /** Called with every member the gate admits (drive access sync, 1.10). */
  onMember?: (member: Member) => void;
  /** Called with an authenticated address that is not a member (revocation). */
  onRefused?: (address: string) => void;
}

export type AcceptedMemberCheck = Extract<MemberCheck, { ok: true }>;

export type RequireCapability = (
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  cap: Capability,
  ctx?: CapabilityContext,
) => Promise<AcceptedMemberCheck | null>;

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
/** A key verified within this long re-verifies without the lookup caps. */
const TRUSTED_MS = 24 * 60 * 60_000;
const WINDOW_MS = 60_000;
const CACHE_MAX = 500;

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

type GateOutcome =
  | { kind: "operator" }
  | { kind: "local" }
  | { kind: "unauthenticated" }
  | { kind: "bearer"; claims: BearerClaims; delegated: () => Promise<boolean> };

/** Operator secret, local mode, or a verified Studio-bound bearer; no role yet. */
function createGate(
  opts: RequestAuthOptions,
): (req: IncomingMessage, queryToken: string | null) => Promise<GateOutcome> {
  const now = opts.now ?? Date.now;
  const verifyBearer = opts.verifyBearer ?? defaultVerifyBearer;
  const verifyDelegation =
    opts.verifyDelegation ??
    (async (jwt: string, audience: string) =>
      (await verifyAuthCredential(jwt, { audience, renownUrl: opts.renownUrl })) !==
      undefined);
  const lookupsPerMinute = opts.lookupsPerMinute ?? 30;
  const lookupsPerKeyPerMinute = opts.lookupsPerKeyPerMinute ?? 3;
  // What a lookup proves is "this wallet delegated to this app key", so
  // verdicts are per (app key, wallet) — every token that key signs for that
  // wallet shares one verdict, however often the client mints.
  const verdicts = new Map<string, { ok: boolean; until: number }>();
  const inFlight = new Map<string, Promise<boolean>>();
  // Keys that verified recently: their re-checks skip the caps, so a flood of
  // fresh attacker keys can't lock out the owner's already-verified key.
  const trusted = new Map<string, number>();
  // Caps on lookups for keys not yet trusted: per key, and overall.
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

  async function delegated(
    jwt: string,
    audience: string,
    claims: BearerClaims,
  ): Promise<boolean> {
    const key = `${claims.appDid}|${claims.address.toLowerCase()}`;
    const t = now();
    const hit = verdicts.get(key);
    if (hit && hit.until > t) return hit.ok;
    const running = inFlight.get(key);
    if (running) return running;
    const lastOk = trusted.get(key);
    const isTrusted = lastOk !== undefined && t - lastOk < TRUSTED_MS;
    // Over the cap: refused, not cached — retried once the window rolls.
    if (!isTrusted && !allowUnknownLookup(key, t)) return false;
    const lookup = (async () => {
      let ok = false;
      try {
        ok = await verifyDelegation(jwt, audience);
      } catch {
        ok = false;
      }
      const done = now();
      boundedSet(verdicts, key, { ok, until: done + (ok ? OK_TTL_MS : FAIL_TTL_MS) });
      if (ok) boundedSet(trusted, key, done);
      return ok;
    })();
    inFlight.set(key, lookup);
    try {
      return await lookup;
    } finally {
      inFlight.delete(key);
    }
  }

  return async (req, queryToken): Promise<GateOutcome> => {
    const secret = process.env.VETRA_SESSION_EXPORT_SECRET;
    const admins = process.env.ADMINS;
    const bearer = bearerOf(req);

    if (secret) {
      const provided = bearer ?? queryToken ?? "";
      if (provided.length > 0 && sha256Eq(provided, secret)) {
        return { kind: "operator" };
      }
    }

    const hasAdmins = (admins ?? "").trim().length > 0;
    const localMode = !opts.cloud && !hasAdmins && !secret;
    if (localMode && isLocalRequest(req)) return { kind: "local" };

    if (!bearer) return { kind: "unauthenticated" };
    // Fail closed: no known public origin means no token can be bound to this
    // Studio. (Whether an owner/member is configured is the caller's check.)
    const audience = originOf(opts.audience());
    if (!audience) return { kind: "unauthenticated" };

    let claims: BearerClaims | false = false;
    try {
      claims = await verifyBearer(bearer, audience);
    } catch {
      claims = false;
    }
    if (!claims) return { kind: "unauthenticated" };
    return { kind: "bearer", claims, delegated: () => delegated(bearer, audience, claims) };
  };
}

const refusedOwner: OwnerCheck = { ok: false, status: 401, error: "unauthorized" };
const refusedMember: MemberCheck = { ok: false, status: 401, error: "unauthorized" };

/** The Studio's owner gate (S1): ADMINS, then the wallet's app delegation. */
export function createRequestAuthorizer(opts: RequestAuthOptions): RequestAuthorizer {
  const gate = createGate(opts);
  return async (req, queryToken) => {
    const out = await gate(req, queryToken);
    if (out.kind === "operator" || out.kind === "local") return { ok: true, via: out.kind };
    if (out.kind !== "bearer") return refusedOwner;
    const admins = process.env.ADMINS ?? "";
    // Address check before the network one: a non-owner never costs a lookup.
    if (!admins.trim() || !isAdminAddress(out.claims.address, admins)) return refusedOwner;
    if (!(await out.delegated())) return refusedOwner;
    return { ok: true, via: "owner", address: out.claims.address };
  };
}

/**
 * The member gate (P6): the same Studio-bound bearer rules, but the address is
 * resolved through Studio membership (org role / ADMINS) instead of ADMINS
 * alone. A Renown failure refuses (`access-unavailable`) rather than guessing.
 */
export function createMemberAuthorizer(opts: MemberAuthOptions): MemberAuthorizer {
  const gate = createGate(opts);
  return async (req, queryToken) => {
    const out = await gate(req, queryToken);
    if (out.kind === "operator") return { ok: true, via: "operator", member: null };
    if (out.kind === "local") return { ok: true, via: "local", member: null };
    if (out.kind !== "bearer") return refusedMember;

    let member: Member | null;
    try {
      member = await opts.membership.resolve(out.claims.address);
    } catch {
      return { ok: false, status: 403, error: "access-unavailable" };
    }
    if (!member) {
      opts.onRefused?.(out.claims.address);
      return { ok: false, status: 403, error: "forbidden" };
    }
    if (!(await out.delegated())) return refusedMember;
    opts.onMember?.(member);
    return { ok: true, via: "member", member };
  };
}

function writeAuthError(res: ServerResponse, status: 401 | 403, error: string): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({ error: status === 403 && error === "access-unavailable" ? error : status === 401 ? "unauthorized" : "forbidden" }));
}

function queryTokenOf(url: string): string | null {
  const idx = url.indexOf("?");
  return idx === -1 ? null : new URLSearchParams(url.slice(idx + 1)).get("token");
}

/**
 * The route gate: 401 when unauthenticated, 403 when authenticated without
 * the capability. Operator and local requests pass (admin-side paths); a
 * member's capability is checked with the route's context.
 */
export function createCapabilityGate(opts: {
  authorizeMember: MemberAuthorizer;
}): RequireCapability {
  return async (req, res, url, cap, ctx = {}) => {
    const check = await opts.authorizeMember(req, queryTokenOf(url));
    if (!check.ok) {
      writeAuthError(res, check.status, check.error);
      return null;
    }
    if (check.via !== "member" || !check.member) return check;
    if (!CAPABILITIES[cap](check.member, ctx)) {
      writeAuthError(res, 403, "forbidden");
      return null;
    }
    return check;
  };
}
