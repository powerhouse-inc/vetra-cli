/**
 * Per-request owner gate for the preview server. See ARCHITECTURE.md →
 * "Preview-server access gate".
 *
 * Authorizes the *sender of the request*, never the daemon's own identity. A
 * request passes when it carries one of:
 *   1. the operator secret (`VETRA_SESSION_EXPORT_SECRET`) as
 *      `Authorization: Bearer <secret>` or `?token=` (constant-time compare);
 *   2. a bearer minted for *this* Studio — `aud` must equal the Studio's
 *      public origin (so a token captured by another Studio the owner opens
 *      can't be replayed here) — that verifies: JWT signature + expiry, then
 *      its credential by the hosts' one check (`createCredentialVerifier`:
 *      the record in the store's data folder, else Renown), for a wallet in
 *      the pod's `ADMINS`;
 *   3. local mode only (no studio environment id): a direct-loopback request
 *      with a loopback Host and browser origin. `ADMINS` or the secret do not
 *      end local mode: a project's `.env` may set them, and a local Studio's
 *      owner routes must not then answer 401 to its own tab.
 * A cloud Studio (an environment id) never takes path 3; with `ADMINS` unset,
 * or no known public origin, it refuses every bearer (fail closed). Every
 * bearer refusal is the same 401, so the gate is no oracle for which wallet
 * is the owner.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  carriedCredentialOf,
  createCredentialVerifier,
  verifyAuthBearerToken,
  type CredentialVerifier,
  type PowerhouseVerifiableCredential,
} from "@renown/sdk/node";
import { isAdminAddress } from "../auth/owner-rule.js";

export type OwnerCheck =
  | { ok: true; via: "operator" | "owner" | "local"; address?: string }
  | { ok: false; status: 401; error: string };

/** A verified bearer's claimed identity (signature, expiry, `aud` checked). */
export interface BearerClaims {
  address: string;
  /** The session key's did:key, which signed the bearer. */
  appDid: string;
  /** 1 when the bearer names none. */
  chainId?: number;
  /** "eip155" when the bearer names none. */
  networkId?: string;
  /** The credential the bearer carries (`phCredential`), when it carries one. */
  credential?: PowerhouseVerifiableCredential;
}

export interface RequestAuthOptions {
  /** The Renown the Studio's Connect logs in on (`resolveStudioRenownUrl`);
   *  undefined = the SDK default. */
  renownUrl: string | undefined;
  /** The store's data folder, whose credential records the check reads first. */
  dataDir: string;
  /** Running as a cloud Studio (`config.environmentId` set). */
  cloud: boolean;
  /** This Studio's public origin (the required `aud`), read per request;
   *  undefined = not known yet, every bearer is refused. */
  audience: () => string | undefined;
  /** Local JWT check (signature + expiry + `aud`). Default: `@renown/sdk`. */
  verifyBearer?: (jwt: string, audience: string) => Promise<BearerClaims | false>;
  /** Whether the wallet's credential naming the bearer's key holds: false
   *  when it does not, throws when it could not be checked. Default: the
   *  hosts' check over `dataDir` (record, then Renown). */
  verifyCredential?: (claims: BearerClaims) => Promise<boolean>;
  /** Max checks per minute for not-yet-verified session keys, overall
   *  (default 30). Recently verified keys are never capped. */
  lookupsPerMinute?: number;
  /** Max checks per minute for one not-yet-verified key (default 3). */
  lookupsPerKeyPerMinute?: number;
  /** Max checks per minute from one client address, for not-yet-verified
   *  keys (default a third of `lookupsPerMinute`, at least 1), so one client
   *  can't spend the whole overall cap. */
  lookupsPerClientPerMinute?: number;
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
 * `x-forwarded-for` hop loopback (a proxy in front appends the real client
 * address, so a LAN or ingress hop shows up here), a
 * loopback Host (a proxy rewrites Host, so through it the browser's Host is
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
  const subject = verified.verifiableCredential.credentialSubject;
  const address = subject.address;
  const appDid = verified.issuer;
  if (typeof address !== "string" || !address || !appDid) return false;
  const credential = carriedCredentialOf(verified);
  return {
    address,
    appDid,
    chainId: Number(subject.chainId),
    networkId: String(subject.networkId),
    ...(credential ? { credential } : {}),
  };
}

/** The hosts' check of the credential a bearer's key acts under. */
function checkWith(verifier: () => CredentialVerifier) {
  return async (claims: BearerClaims): Promise<boolean> => {
    const verdict = await verifier().check(
      {
        address: claims.address,
        chainId: claims.chainId ?? 1,
        networkId: claims.networkId ?? "eip155",
        sessionDid: claims.appDid,
      },
      claims.credential,
    );
    if (verdict.ok) return true;
    // No answer at all is no verdict on the key.
    if (verdict.reason === "unverifiable") throw new Error("credential not checkable now");
    return false;
  };
}

const FAIL_TTL_MS = 30_000;
/** A key verified within this long is checked again without the caps. */
const TRUSTED_MS = 24 * 60 * 60_000;
const WINDOW_MS = 60_000;
const CACHE_MAX = 500;

/** Expand an IPv6 address to its 8 groups; null when it isn't one. */
function ipv6Groups(addr: string): string[] | null {
  const a = addr.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!a.includes(":") || /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(a)) return null;
  const [head, tail, extra] = a.split("::");
  if (extra !== undefined) return null;
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(Math.max(fill, 0)).fill("0"), ...right];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ""));
}

/** One bucket per client: an IPv4 address, or an IPv6 address's /64 (a
 *  single host usually holds a whole /64). */
function clientBucket(addr: string): string {
  const groups = ipv6Groups(addr);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : addr;
}

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
 * The address a check is charged to: the right-most hop that isn't loopback
 * or inside the hosting network. Each proxy appends the address it saw, so
 * hops a client writes itself sit to the left of it and never change the
 * answer. All hops internal (local runs): the right-most non-loopback one.
 * IPv6 addresses are charged by their /64.
 */
export function clientAddress(req: IncomingMessage): string {
  const xff = headerValue(req, "x-forwarded-for");
  const hops = [
    ...(xff ? xff.split(",").map((h) => h.trim()).filter(Boolean) : []),
    req.socket?.remoteAddress ?? "",
  ].filter(Boolean);
  const outside = hops.filter((h) => !isLoopbackAddress(h));
  return clientBucket(
    [...outside].reverse().find((h) => !isPrivateAddress(h)) ??
      outside.at(-1) ??
      hops.at(-1) ??
      "unknown",
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

export function createRequestAuthorizer(opts: RequestAuthOptions): RequestAuthorizer {
  const now = opts.now ?? Date.now;
  const verifyBearer = opts.verifyBearer ?? defaultVerifyBearer;
  let verifier: CredentialVerifier | undefined;
  const verifyCredential =
    opts.verifyCredential ??
    checkWith(
      () =>
        (verifier ??= createCredentialVerifier({
          dataDir: opts.dataDir,
          ...(opts.renownUrl ? { renownUrl: opts.renownUrl } : {}),
          // No sockets here to close on a withdrawal: each request asks.
          watch: false,
        })),
    );
  const lookupsPerMinute = opts.lookupsPerMinute ?? 30;
  const lookupsPerKeyPerMinute = opts.lookupsPerKeyPerMinute ?? 3;
  const lookupsPerClientPerMinute =
    opts.lookupsPerClientPerMinute ?? Math.max(1, Math.floor(lookupsPerMinute / 3));
  // Kept back for clients that haven't asked yet this window, so a few
  // flooding clients can't spend the whole cap before the owner's new device
  // asks. A flood from many addresses still spends it: this bounds the
  // checks Renown sees, it can't promise one to the owner (the trusted keys
  // do that for devices that verified before).
  const reserved = Math.floor(lookupsPerMinute / 10);
  // A refusal is per (session key, wallet) and kept briefly; a key that
  // verified is asked again on every request, so a withdrawn record refuses
  // at once (the check reads the record's file, Renown at most once a
  // minute), and it skips the caps.
  const refusals = new Map<string, number>();
  const inFlight = new Map<string, Promise<boolean>>();
  const trusted = new Map<string, number>();
  // Caps on checks for keys not yet trusted: per key, per client, overall.
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
    const limit = c.count === 0 ? lookupsPerMinute : lookupsPerMinute - reserved;
    if (
      k.count >= lookupsPerKeyPerMinute ||
      c.count >= lookupsPerClientPerMinute ||
      unknownLookups >= limit
    ) {
      return false;
    }
    k.count++;
    c.count++;
    unknownLookups++;
    return true;
  }

  async function delegated(claims: BearerClaims, client: string): Promise<boolean> {
    const key = `${claims.appDid}|${claims.address.toLowerCase()}`;
    const t = now();
    const refusedUntil = refusals.get(key);
    if (refusedUntil !== undefined && refusedUntil > t) return false;
    const running = inFlight.get(key);
    if (running) return running;
    const lastOk = trusted.get(key);
    const isTrusted = lastOk !== undefined && t - lastOk < TRUSTED_MS;
    // Over the cap: refused, not kept — asked again once the window rolls.
    if (!isTrusted && !allowUnknownLookup(key, client, t)) return false;
    const lookup = (async () => {
      let ok: boolean;
      try {
        ok = await verifyCredential(claims);
      } catch {
        // Could not be checked: refused now, asked again on the next request.
        return false;
      }
      if (ok) {
        refusals.delete(key);
        boundedSet(trusted, key, now());
      } else {
        trusted.delete(key);
        boundedSet(refusals, key, now() + FAIL_TTL_MS);
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
    // Local by the environment id alone (see the module comment).
    if (!opts.cloud && isLocalRequest(req)) return { ok: true, via: "local" };

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
    // Address check before the credential's: a non-owner never costs a check.
    if (!isAdminAddress(claims.address, admins)) return refused;
    if (!(await delegated(claims, clientAddress(req)))) return refused;
    return { ok: true, via: "owner", address: claims.address };
  };
}
