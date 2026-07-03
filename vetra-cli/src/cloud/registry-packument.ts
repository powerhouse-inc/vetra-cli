/**
 * Read an npm packument from a registry. Uses the FULL document
 * (`accept: application/json`) rather than the abbreviated corgi format
 * (`application/vnd.npm.install-v1+json`), because the abbreviated format strips
 * custom per-version fields — and the release check needs each version's
 * embedded `powerhouse.contentHash`. Shared by `reactor-project-publish-status`
 * and the preview-server release-status check.
 *
 * The registry sits behind an HTTP cache that serves stale packuments
 * (observed `x-cache-status: STALE`) for minutes after a publish, which made
 * a just-published version read as "not published". Every read is forced
 * fresh: a unique query param defeats the cache key, plus no-cache headers.
 */

export type PackumentVersion = {
  version?: string;
  powerhouse?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PackumentResult =
  | {
      kind: "ok";
      latest: string | null;
      versions: Record<string, PackumentVersion>;
    }
  | { kind: "not-found" }
  | { kind: "auth-required"; status: number }
  | { kind: "error"; reason: string };

function packumentUrl(registryUrl: string, pkgName: string): string {
  const base = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;
  return base + pkgName.replace("/", "%2f");
}

/* Keep error reasons to a couple of meaningful lines so a consumer's context
 * isn't flooded. */
function condense(message: string): string {
  return message
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

async function fetchPackumentOnce(
  registryUrl: string,
  pkgName: string,
  token: string | null,
): Promise<PackumentResult> {
  // Cache-bust: the registry's HTTP cache keys on the full URL, so a unique
  // query param forces a fresh origin read (the no-cache headers handle caches
  // that honor them). Date.now() is fine here — this is daemon/CLI code.
  const url = `${packumentUrl(registryUrl, pkgName)}?_=${Date.now()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        pragma: "no-cache",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    return {
      kind: "error",
      reason: condense(err instanceof Error ? err.message : String(err)),
    };
  }

  if (res.status === 404) return { kind: "not-found" };
  if (res.status === 401 || res.status === 403) {
    return { kind: "auth-required", status: res.status };
  }
  if (!res.ok) {
    return { kind: "error", reason: `registry returned HTTP ${res.status}` };
  }

  let body: {
    versions?: Record<string, PackumentVersion>;
    "dist-tags"?: Record<string, string>;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    return {
      kind: "error",
      reason: condense(err instanceof Error ? err.message : String(err)),
    };
  }

  return {
    kind: "ok",
    latest: body["dist-tags"]?.latest ?? null,
    versions: body.versions ?? {},
  };
}

/**
 * Read a packument anonymously. Package reads are public on this registry
 * (verdaccio `access: "$all"`); the Renown token (`aud` = registry) is for
 * `publish` (writes) — exactly how ph-cli uses it.
 *
 * A FRESH read is only possible anonymously here. The registry sits behind a
 * cache that serves stale packuments on a hit, and only a cache-busting query
 * param forces a fresh origin read — but the origin returns 403 for ANY
 * authenticated package GET (verified: token+no-query → cached 200; token+query
 * → origin 403; anon+query → origin 200 fresh). So sending the token can't get
 * fresh data, only a stale cache hit. The token stays as a fallback for a
 * registry that genuinely gates reads (anonymous → 401/403).
 */
export async function fetchPackument(
  registryUrl: string,
  pkgName: string,
  token: string | null,
): Promise<PackumentResult> {
  const anon = await fetchPackumentOnce(registryUrl, pkgName, null);
  if (anon.kind === "auth-required" && token) {
    return fetchPackumentOnce(registryUrl, pkgName, token);
  }
  return anon;
}
