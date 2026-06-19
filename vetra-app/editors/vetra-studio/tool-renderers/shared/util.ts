// Shared helpers for the per-tool renderers. vetra-app ships no
// clsx/tailwind-merge, so these stay dependency-free.

/** Join truthy class names. */
export function cx(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/** Truncate `s` to `max` chars with an ellipsis. */
export function truncate(s: string, max = 48): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Render an already-parsed tool arg/result value as display text. */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}

/** Coerce parsed args to a record for safe field access. */
export function asRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === "object"
    ? (args as Record<string, unknown>)
    : {};
}

/** Non-empty string field, else undefined. */
export function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** The path-like arg of a tool (`file_path` or `path`). */
export function pathOf(a: Record<string, unknown>): string | undefined {
  return str(a.file_path) ?? str(a.path);
}

/** First non-empty string value among the args (for tools with no known key). */
export function firstStringValue(
  a: Record<string, unknown>,
): string | undefined {
  for (const v of Object.values(a)) if (typeof v === "string" && v) return v;
  return undefined;
}

/** Whether a `spec-*` tool name is a mutating verb. */
export function isWriteVerb(toolName: string): boolean {
  return /-(create|update|delete|generate|extract)$/.test(toolName);
}
