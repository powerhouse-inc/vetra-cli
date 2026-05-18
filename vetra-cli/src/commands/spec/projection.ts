/**
 * Projection + encoding helpers for spec output.
 *
 * `applyJsonPath` evaluates an RFC 9535 JSONPath against a value and returns
 * the match (unwrapped if exactly one, array if many, undefined if none).
 *
 * `encodeValue` renders a value as a string in one of two wire encodings:
 *  - `"json"` — `JSON.stringify(value, null, 2)`
 *  - `"toon"` — TOON via `@toon-format/toon`; ~40% smaller than JSON for
 *    tabular structures. Scalars are wrapped in `{ value }` so the encoder
 *    doesn't reject them.
 *
 * Special case: when `value` is a string, both formats print it raw — no
 * quoting, no `\n` escapes, no `value:` wrapper. This is what we want for
 * GraphQL schema fields, descriptions, or any single-string projection
 * result: the consumer reads actual text instead of a JSON-encoded blob.
 */
import { encode as encodeToon } from "@toon-format/toon";
import { JSONPath } from "jsonpath-plus";

export type OutputFormat = "json" | "toon";

export function applyJsonPath<T = unknown>(value: unknown, path: string): T {
  let results: unknown[];
  try {
    results = JSONPath({ path, json: value as object, resultType: "value" });
  } catch (err) {
    throw new Error(
      `Invalid JSONPath "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (results.length === 0) return undefined as T;
  if (results.length === 1) return results[0] as T;
  return results as T;
}

export function encodeValue(
  value: unknown,
  format: OutputFormat = "json",
): string {
  // Raw text for single strings — readable for GraphQL schemas etc.
  if (typeof value === "string") return value;

  if (format === "toon") {
    const payload =
      value !== null && (typeof value === "object" || Array.isArray(value))
        ? value
        : { value };
    return encodeToon(payload);
  }
  return JSON.stringify(value, null, 2);
}
