// Access gate for the /sessions* endpoints. See ARCHITECTURE.md → "Session export".
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

function sha256Eq(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// A browser cross-site fetch carries an Origin; a curl/top-level nav carries
// none. Reject any Origin whose host isn't loopback (blocks cross-site reads).
function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const h = new URL(origin).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

// Secret set → require a matching bearer/token (works via proxy); unset → allow
// only direct loopback: no proxy x-forwarded-* tag and a loopback-or-absent Origin.
export function authorizeSessions(
  headers: IncomingMessage["headers"],
  token: string | null,
): boolean {
  const secret = process.env.VETRA_SESSION_EXPORT_SECRET;
  if (secret) {
    const auth = headers["authorization"];
    const bearer =
      typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const provided = bearer ?? token ?? "";
    return provided.length > 0 && sha256Eq(provided, secret);
  }
  if (headers["x-forwarded-prefix"] !== undefined || headers["x-forwarded-for"] !== undefined) {
    return false;
  }
  const origin = headers["origin"];
  return isLocalOrigin(typeof origin === "string" ? origin : undefined);
}
