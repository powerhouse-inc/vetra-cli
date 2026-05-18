import { readFile } from "node:fs/promises";
import {
  getDocument,
  getDocuments,
  specPath,
} from "@powerhousedao/vetra/codegen";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { z } from "zod";
import { applyJsonPath, encodeValue, type OutputFormat } from "./projection.js";

export const formatSchema = z
  .enum(["json", "toon"])
  .describe(
    'Output encoding. "json" (default) is universal; "toon" (Token-Oriented Object Notation) is ~40% smaller — prefer it when the projected result is still large.',
  );

export const actionInputSchema = z.object({
  type: z
    .string()
    .describe(
      'Action name in SCREAMING_SNAKE_CASE, e.g. "SET_EDITOR_NAME". Must be one of the operations listed in `spec-schema` for the doc\'s type.',
    ),
  input: z
    .unknown()
    .optional()
    .describe(
      "Action payload. Shape comes from the action's input schema in `spec-schema`.",
    ),
  scope: z
    .string()
    .optional()
    .describe('Action scope. Defaults to "global"; rarely needs overriding.'),
});

export type ActionInput = z.infer<typeof actionInputSchema>;

/**
 * Project + encode a value for output. When neither --filter nor --format is
 * set, return a short human summary as `text` and the full value as `data`;
 * otherwise return only the rendered text (passing both defeats the savings).
 * Single-string projections come out raw — see encodeValue for why.
 */
export function renderProjected(
  value: unknown,
  filter: string | undefined,
  format: OutputFormat | undefined,
  fallbackText: string,
): { text: string; data?: { value: unknown } } {
  if (!filter && !format) {
    return { text: fallbackText, data: { value } };
  }
  const projected = filter ? applyJsonPath(value, filter) : value;
  return { text: encodeValue(projected, format) };
}

/**
 * Resolve a spec by its display name. Throws if not found or ambiguous.
 * Also returns the on-disk path, needed by callers that delete the file
 * directly (saveSpec recomputes it from the doc).
 */
export async function findByName(
  workdir: string,
  name: string,
): Promise<{ doc: PHDocument; path: string }> {
  const docs = await getDocuments(workdir);
  const matches = docs.filter((d) => d.header.name === name);
  if (matches.length === 0) {
    throw new Error(`No spec found with name "${name}".`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple specs found with name "${name}" — names must be unique.`,
    );
  }
  const doc = matches[0];
  const path = specPath(workdir, doc.header.documentType, doc.header.name);
  return { doc, path };
}

/**
 * Resolve a JSON actions payload from one of three sources, in priority order:
 *   1. `actions` — inline array (preferred for agent tool calls).
 *   2. `from`    — file path (CLI human convenience).
 *   3. piped stdin, only when stdin is not a TTY (CLI pipe usage).
 *
 * Errors fast if none of those apply. We deliberately do not accept a literal
 * "-" for stdin: under a TTY it hangs forever waiting for EOF, and under
 * piping the auto-detection already kicks in.
 */
export async function resolveActionsInput(opts: {
  actions?: unknown;
  from?: string;
}): Promise<ActionInput[]> {
  let parsed: unknown;
  if (opts.actions !== undefined) {
    parsed = opts.actions;
  } else if (opts.from) {
    const raw = await readFile(opts.from, "utf8");
    parsed = parseJson(raw);
  } else if (!process.stdin.isTTY) {
    const raw = await readStdinAll();
    parsed = parseJson(raw);
  } else {
    throw new Error(
      "No actions provided. Pass actions inline, --from <file>, or pipe JSON to stdin.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Actions input must be a JSON array of action objects.");
  }
  return z.array(actionInputSchema).parse(parsed);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in actions input: ${(err as Error).message}`);
  }
}

async function readStdinAll(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

/**
 * Render a list of rows as space-aligned columns. Last column is not padded
 * (so trailing whitespace doesn't get baked into the output).
 */
export function formatColumns(rows: string[][]): string {
  if (rows.length === 0) return "";
  const cols = rows[0].length;
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(...rows.map((r) => (r[i] ?? "").length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, i) =>
          i < cols - 1 ? (cell ?? "").padEnd(widths[i]) : (cell ?? ""),
        )
        .join("   "),
    )
    .join("\n");
}

/** Load a spec by name and return the document — convenience wrapper. */
export async function loadByName(
  workdir: string,
  name: string,
): Promise<PHDocument> {
  const { path } = await findByName(workdir, name);
  return getDocument(path);
}
