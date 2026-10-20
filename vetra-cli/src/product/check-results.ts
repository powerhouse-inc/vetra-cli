/**
 * Check results a command actually observed, carried on its return value (or
 * thrown error) for the check recorder.
 *
 * The property is non-enumerable, so it never reaches the model through JSON
 * serialization of the tool result; the recorder reads it right after the
 * tool's execute returns. A command that did not run any check attaches
 * nothing, and the recorder records nothing.
 */
import os from "node:os";
import path from "node:path";
import type { CheckResultInput } from "vetra-app/document-models/studio-product";
import { FORBIDDEN_WORDS } from "./forbidden-words.js";

export type ObservedCheck = {
  kind: CheckResultInput["kind"];
  passed: boolean;
  /** Stored in the product document and shown to the customer: plain, one line. */
  reason: string | null;
  /** Raw detail for the agent's tool output only; never stored. */
  detail?: string;
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

/* Customer-safe stand-ins for the forbidden words (Ruling F40b). */
const PLAIN_WORDS: Record<(typeof FORBIDDEN_WORDS)[number], string> = {
  environment: "setup",
  package: "app",
  registry: "store",
  Harbor: "store",
  image: "picture",
  workflow: "process",
  "device code": "sign-in code",
  "approve changes": "confirm",
  switchboard: "server",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Make a reason safe to store in the product document, which the customer
 * reads: one line, no local paths (the project path becomes relative, any
 * other absolute path is cut to its file name), no forbidden words, capped.
 */
export function capReason(
  text: string,
  opts: { base?: string; max?: number } = {},
): string {
  let out = text;
  const roots = [opts.base, os.homedir()].filter((r): r is string => !!r && r !== path.sep);
  for (const root of roots) {
    out = out.replace(new RegExp(`${escapeRegExp(root.replace(/[\\/]+$/, ""))}[\\\\/]?`, "g"), "");
  }
  // Any absolute path left (POSIX or Windows) → its last segment.
  out = out.replace(/(?<=^|[\s"'(=])(?:[A-Za-z]:)?(?:[\\/][^\s\\/:;,"'()]+){2,}/g, (p) => p.split(/[\\/]/).pop() ?? "");
  for (const word of FORBIDDEN_WORDS) {
    out = out.replace(new RegExp(escapeRegExp(word), "gi"), PLAIN_WORDS[word]);
  }
  out = out.replace(/\s+/g, " ").trim();
  const max = opts.max ?? 300;
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
