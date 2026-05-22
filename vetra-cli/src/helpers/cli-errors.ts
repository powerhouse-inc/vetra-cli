import { suggestNames } from "./suggestions.js";

/**
 * Throw a `Missing required option --<flag>.` error, with an optional hint
 * appended on the next line. Used by commands that declare their input as
 * `z.string().default("")` to dodge commander's double-emitted required-option
 * error — they receive the empty sentinel here and surface a single, richer
 * message (often a list of available values) instead.
 */
export function requireOption(
  value: string,
  flag: string,
  hint?: string,
): asserts value is string {
  if (value) return;
  throw new Error(formatLines(`Missing required option --${flag}.`, hint));
}

export interface UnknownValueOptions {
  /** Short noun the error leads with, e.g. "spec", "document type", "action". */
  subject: string;
  /** The bad value the caller passed. */
  value: string;
  /** Known names to search for a "Did you mean: …" hint. */
  candidates: string[];
  /** Label for the full enumeration line, e.g. "Valid types" or "Available specs". */
  knownLabel?: string;
  /** Suppress the enumeration line when the list grows past this size and use `overflowHint` instead. */
  inlineLimit?: number;
  /** Single line shown in place of the enumeration when `candidates` exceeds `inlineLimit`. */
  overflowHint?: string;
  /** Extra context appended after the leading line, before suggestions. */
  context?: string;
}

/**
 * Build the standard "Unknown <subject> "<value>". / Did you mean: …? /
 * Valid …" multi-line error. Variations across call sites are expressed as
 * label/limit/overflow options rather than hand-written line arrays.
 */
export function unknownValueError(opts: UnknownValueOptions): Error {
  const {
    subject,
    value,
    candidates,
    knownLabel,
    inlineLimit,
    overflowHint,
    context,
  } = opts;
  const lines: string[] = [`Unknown ${subject} "${value}"${context ? ` ${context}` : ""}.`];
  const suggestions = suggestNames(value, candidates);
  if (suggestions.length > 0) {
    lines.push(`Did you mean: ${suggestions.join(", ")}?`);
  }
  if (knownLabel) {
    if (
      typeof inlineLimit === "number" &&
      candidates.length > inlineLimit &&
      overflowHint
    ) {
      lines.push(overflowHint);
    } else {
      lines.push(`${knownLabel}: ${candidates.join(", ")}`);
    }
  }
  return new Error(lines.join("\n"));
}

/** Join a main message with an optional hint on its own line. */
export function formatLines(message: string, hint: string | undefined): string {
  return hint ? `${message}\n${hint}` : message;
}
