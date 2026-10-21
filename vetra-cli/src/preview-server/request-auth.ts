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
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { verifyAuthBearerToken, verifyAuthCredential } from "@renown/sdk/node";
import { isAdminAddress } from "../auth/renown.js";

/** The store of recently verified keys, under the agent's `.ph/` data dir. */
export const TRUSTED_KEYS_FILE = "preview-trusted-keys.json";

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
  /** Max lookups per minute from one client address, for not-yet-verified
   *  keys (default a third of `lookupsPerMinute`, at least 1), so one client
   *  can't spend the whole overall cap. */
  lookupsPerClientPerMinute?: number;
  /** File that keeps the recently verified keys (`appDid|address` and when
   *  each verified, never a token) across restarts; written mode 600.
   *  Undefined = kept in memory only. */
  trustedStorePath?: string;
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
/** A key verified within this long re-verifies without the lookup caps. */
const TRUSTED_MS = 24 * 60 * 60_000;
const WINDOW_MS = 60_000;
const CACHE_MAX = 500;

/** RFC 1918 / CGNAT / link-local / ULA: an address inside the hosting network. */
function isPrivateAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase().replace(/^::ffff:/, "");
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    return (
      x === 10 ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254)
    );
  }
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

/**
 * The address a lookup is charged to: the right-most hop that isn't loopback
 * or inside the hosting network. Each proxy appends the address it saw, so
 * hops a client writes itself sit to the left of it and never change the
 * answer. All hops internal (local runs): the right-most non-loopback one.
 */
export function clientAddress(req: IncomingMessage): string {
  const xff = headerValue(req, "x-forwarded-for");
  const hops = [
    ...(xff ? xff.split(",").map((h) => h.trim()).filter(Boolean) : []),
    req.socket?.remoteAddress ?? "",
  ].filter(Boolean);
  const outside = hops.filter((h) => !isLoopbackAddress(h));
  return (
    [...outside].reverse().find((h) => !isPrivateAddress(h)) ??
    outside.at(-1) ??
    hops.at(-1) ??
    "unknown"
  );
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

/** Recently verified keys from `file`, without the ones past `TRUSTED_MS`. */
function loadTrusted(file: string | undefined, t: number): Map<string, number> {
  const out = new Map<string, number>();
  if (!file) return out;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as { keys?: unknown };
    const keys = raw.keys && typeof raw.keys === "object" ? raw.keys : {};
    const entries = Object.entries(keys as Record<string, unknown>)
      .filter((e): e is [string, number] => typeof e[1] === "number" && e[0].includes("|"))
      .filter(([, at]) => t - at < TRUSTED_MS && at <= t)
      .sort((x, y) => x[1] - y[1]);
    for (const [key, at] of entries) boundedSet(out, key, at);
  } catch {
    // No store yet, or unreadable: start empty.
  }
  return out;
}

/** Write `trusted` to `file` (mode 600, atomic rename). Best effort. */
function saveTrusted(file: string | undefined, trusted: Map<string, number>): void {
  if (!file) return;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify({ version: 1, keys: Object.fromEntries(trusted) }), {
      mode: 0o600,
    });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch {
    // Kept in memory; the next verification writes again.
  }
}

export function createRequestAuthorizer(opts: RequestAuthOptions): RequestAuthorizer {
  const now = opts.now ?? Date.now;
  const verifyBearer = opts.verifyBearer ?? defaultVerifyBearer;
  const verifyDelegation =
    opts.verifyDelegation ??
    (async (jwt: string, audience: string) =>
      (await verifyAuthCredential(jwt, { audience, renownUrl: opts.renownUrl })) !==
      undefined);
  const lookupsPerMinute = opts.lookupsPerMinute ?? 30;
  const lookupsPerKeyPerMinute = opts.lookupsPerKeyPerMinute ?? 3;
  const lookupsPerClientPerMinute =
    opts.lookupsPerClientPerMinute ?? Math.max(1, Math.floor(lookupsPerMinute / 3));
  // What a lookup proves is "this wallet delegated to this app key", so
  // verdicts are per (app key, wallet) — every token that key signs for that
  // wallet shares one verdict, however often the client mints.
  const verdicts = new Map<string, { ok: boolean; until: number }>();
  const inFlight = new Map<string, Promise<boolean>>();
  // Keys that verified recently: their re-checks skip the caps, so a flood of
  // fresh attacker keys can't lock out the owner's already-verified key. Kept
  // in `trustedStorePath` so a restart doesn't drop them.
  const trusted = loadTrusted(opts.trustedStorePath, now());
  // Caps on lookups for keys not yet trusted: per key, per client, overall.
  const perKey = new Map<string, { start: number; count: number }>();
  const perClient = new Map<string, { start: number; count: number }>();
  let windowStart = 0;
  let unknownLookups = 0;

  function windowOf(
    map: Map<string, { start: number; count: number }>,
    key: string,
    t: number,
  ): { start: number; count: number } {
    let w = map.get(key);
    if (!w || t - w.start >= WINDOW_MS) {
      w = { start: t, count: 0 };
      boundedSet(map, key, w);
    }
    return w;
  }

  function allowUnknownLookup(key: string, client: string, t: number): boolean {
    if (t - windowStart >= WINDOW_MS) {
      windowStart = t;
      unknownLookups = 0;
    }
    const k = windowOf(perKey, key, t);
    const c = windowOf(perClient, client, t);
    if (
      k.count >= lookupsPerKeyPerMinute ||
      c.count >= lookupsPerClientPerMinute ||
      unknownLookups >= lookupsPerMinute
    ) {
      return false;
    }
    k.count++;
    c.count++;
    unknownLookups++;
    return true;
  }

  async function delegated(
    jwt: string,
    audience: string,
    claims: BearerClaims,
    client: string,
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
    if (!isTrusted && !allowUnknownLookup(key, client, t)) return false;
    const lookup = (async () => {
      let ok = false;
      // A lookup that couldn't run (network) is no verdict on the key.
      let refused = false;
      try {
        ok = await verifyDelegation(jwt, audience);
        refused = !ok;
      } catch {
        ok = false;
      }
      const done = now();
      boundedSet(verdicts, key, { ok, until: done + (ok ? OK_TTL_MS : FAIL_TTL_MS) });
      if (ok) {
        boundedSet(trusted, key, done);
        saveTrusted(opts.trustedStorePath, trusted);
      } else if (refused && trusted.delete(key)) {
        saveTrusted(opts.trustedStorePath, trusted);
      }
      return ok;
    })();
    inFlight.set(key, lookup);
    try {
      return await lookup;
    } finally {
      inFlight.delete(key);
    }
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
    if (!(await delegated(bearer, audience, claims, clientAddress(req)))) return refused;
    return { ok: true, via: "owner", address: claims.address };
  };
}
