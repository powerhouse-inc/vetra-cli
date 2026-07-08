/** Shared helpers for the Deploy section. */

/** Duck-typed graphql-request ClientError (instanceof doesn't survive
 * bundling): carries the HTTP response, and its `message` embeds the full
 * request + response as JSON — never show that to the user. */
type ApiError = Error & { response?: { status?: unknown } };

/** HTTP status carried by a failed API call, if any. */
export function errorStatus(err: unknown): number | null {
  const status = (err as ApiError | null)?.response?.status;
  if (typeof status === "number") return status;
  const msg = err instanceof Error ? err.message : "";
  const code = /^GraphQL Error \(Code: (\d+)\)/.exec(msg);
  return code ? Number(code[1]) : null;
}

/** True when the cloud rejected the caller's credentials (expired/invalid
 * Renown session). */
export function isAuthError(err: unknown): boolean {
  return errorStatus(err) === 401;
}

/** Normalize an unknown thrown value to a display string. API transport
 * errors are reduced to a concise summary — raw response/request payloads
 * must never reach the UI. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const status = errorStatus(err);
  if (status === null && !raw.startsWith("GraphQL Error")) return raw;
  if (status === 401) {
    return "Your Renown session is no longer valid. Sign in again.";
  }
  return `The cloud request failed${status !== null ? ` (HTTP ${status})` : ""}. Please try again.`;
}
