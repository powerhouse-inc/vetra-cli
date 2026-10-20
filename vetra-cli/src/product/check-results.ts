/**
 * Check results a command actually observed, carried on its return value (or
 * thrown error) for the check recorder.
 *
 * The property is non-enumerable, so it never reaches the model through JSON
 * serialization of the tool result; the recorder reads it right after the
 * tool's execute returns. A command that did not run any check attaches
 * nothing, and the recorder records nothing.
 */
import type { CheckResultInput } from "vetra-app/document-models/studio-product";

export type ObservedCheck = {
  kind: CheckResultInput["kind"];
  passed: boolean;
  reason: string | null;
};

const KEY = "__vetraCheckResults";

export function attachCheckResults<T>(target: T, results: ObservedCheck[]): T {
  if (results.length > 0 && typeof target === "object" && target !== null) {
    Object.defineProperty(target, KEY, { value: results, enumerable: false, configurable: true });
  }
  return target;
}

export function readCheckResults(value: unknown): ObservedCheck[] | null {
  if (typeof value !== "object" || value === null) return null;
  const results = (value as Record<string, unknown>)[KEY];
  return Array.isArray(results) && results.length > 0 ? (results as ObservedCheck[]) : null;
}

/** Cap free text going into the product document. */
export function capReason(text: string, max = 400): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
