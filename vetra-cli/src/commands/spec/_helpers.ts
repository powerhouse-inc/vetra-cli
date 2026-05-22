import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  getDocument,
  getDocumentModelSchema,
  listSpecDocumentTypes,
  specDir,
} from "@powerhousedao/vetra/codegen";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { z } from "zod";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import { suggestNames } from "../../helpers/suggestions.js";
import { applyJsonPath, encodeValue, type OutputFormat } from "./projection.js";

export { suggestNames };


export const formatSchema = z
  .enum(["json", "toon"])
  .describe(
    'Output encoding. "json" (default) is universal; "toon" (Token-Oriented Object Notation) is ~40% smaller — prefer it when the projected result is still large.',
  );

export const actionInputSchema = z.object({
  type: z
    .string()
    .describe(
      "LITERAL action name from `spec-schema --type <doc-type>` for the spec being updated. Do not invent, shorten, or extrapolate by pattern — names are per doc-type and usually include the doc-type prefix (e.g. `SET_SUBGRAPH_NAME`, not `SET_NAME`; `RELEASE_NEW_VERSION`, not `ADD_SPECIFICATION`).",
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
 * Walk every registered spec subdir and yield each `.phd` file's path plus
 * its `basename` (the part before the first dot, which equals
 * `kebabCase(header.name)` for any file produced by `saveSpec`). Cheap — no
 * file is opened. Callers decide which entries to load.
 */
async function* iterateSpecFiles(
  workdir: string,
): AsyncGenerator<{ path: string; basename: string }> {
  for (const documentType of listSpecDocumentTypes()) {
    const dir = specDir(workdir, documentType);
    const isDir = await stat(dir).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!isDir) continue;
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith(".phd")) continue;
      yield {
        path: join(dir, entry),
        basename: entry.split(".")[0] ?? entry,
      };
    }
  }
}

/**
 * Walk every registered spec subdir and return `{ doc, path }` pairs by
 * loading each `.phd`. Mirrors upstream `getDocuments` but keeps the on-disk
 * path — `specPath(workdir, documentType, name)` can disagree with the real
 * file when two docs share a kebab-name (different extensions). Callers like
 * `spec-delete` need the real path so a stale one doesn't remove the wrong
 * file.
 *
 * Use sparingly — it loads every doc into memory. For single-spec lookups,
 * prefer `findByName` which short-circuits via `iterateSpecFiles`.
 */
async function getDocumentsWithPaths(
  workdir: string,
): Promise<{ doc: PHDocument; path: string }[]> {
  const out: { doc: PHDocument; path: string }[] = [];
  for await (const file of iterateSpecFiles(workdir)) {
    out.push({ doc: await getDocument(file.path), path: file.path });
  }
  return out;
}

/**
 * Convert a display name to a URL-safe kebab-case slug. Used by `spec-create`
 * to populate `header.slug` so the doc has a short, stable handle alongside
 * its name and id.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve a spec by display name, slug, or id (in that priority order).
 * Throws if not found or ambiguous. Also returns the on-disk path, needed
 * by callers that delete the file directly.
 */
/* Match priority for `findByName`: name → slug → id. First non-empty match
 * set wins so a name collision with a slug doesn't surface as ambiguity.
 * Empty slugs (legacy docs) are skipped so a caller passing `""` can't match. */
const MATCH_STRATEGIES: Array<
  (header: PHDocument["header"], query: string) => boolean
> = [
  (h, q) => h.name === q,
  (h, q) => !!h.slug && h.slug === q,
  (h, q) => h.id === q,
];

export async function findByName(
  workdir: string,
  name: string,
): Promise<{ doc: PHDocument; path: string }> {
  if (!name) {
    /* Missing-name path needs the full list to build the hint. */
    const entries = await getDocumentsWithPaths(workdir);
    const names = entries
      .map((e) => e.doc.header.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    const hint =
      names.length > 0
        ? `Available specs: ${names.join(", ")}`
        : "No specs found in this project.";
    requireOption(name, "name", hint);
  }

  /* Fast path: every file produced by `saveSpec` is named
   * `${kebabCase(header.name)}.<ext>.phd`, so the basename equals
   * `slugify(header.name)` (or sometimes the raw query itself for slug-typed
   * queries). Match the filename without opening any file, then load only
   * those candidates. The slow path covers id-typed queries and the rare
   * filename/header drift case. */
  const slug = slugify(name);
  const candidates: { doc: PHDocument; path: string }[] = [];
  for await (const file of iterateSpecFiles(workdir)) {
    if (file.basename === slug || file.basename === name) {
      candidates.push({ doc: await getDocument(file.path), path: file.path });
    }
  }
  for (const matches of MATCH_STRATEGIES.map((pred) =>
    candidates.filter((c) => pred(c.doc.header, name)),
  )) {
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Multiple specs match "${name}" — name/slug/id must be unique.`,
      );
    }
  }

  /* Slow path: filename didn't help — load everything for id-based matching
   * and to build the not-found suggestion pool. Skip files already loaded in
   * the fast pass so we don't pay the deserialization twice. */
  const loadedPaths = new Set(candidates.map((c) => c.path));
  const entries: { doc: PHDocument; path: string }[] = [...candidates];
  for await (const file of iterateSpecFiles(workdir)) {
    if (loadedPaths.has(file.path)) continue;
    entries.push({ doc: await getDocument(file.path), path: file.path });
  }
  for (const matches of MATCH_STRATEGIES.map((pred) =>
    entries.filter((e) => pred(e.doc.header, name)),
  )) {
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Multiple specs match "${name}" — name/slug/id must be unique.`,
      );
    }
  }
  /* Dedupe pool so a doc whose name and slug coincide doesn't surface twice.
   * Dedupe is case-insensitive so `workout` (slug) and `Workout` (name) don't
   * both appear — keep the form we saw first (name wins, since it's added
   * before slug). */
  const seen = new Map<string, string>();
  for (const e of entries) {
    for (const s of [e.doc.header.name, e.doc.header.slug]) {
      if (typeof s !== "string" || s.length === 0) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) seen.set(key, s);
    }
  }
  throw unknownValueError({
    subject: "spec",
    value: name,
    candidates: [...seen.values()],
  });
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

/**
 * Validate a document type string. Throws `unknownValueError` with a "Did you
 * mean?" hint plus the full valid-types list when the type is unknown — agent
 * callers can self-correct without round-tripping through a list call. The
 * caller is responsible for the missing-value case via `requireOption`.
 */
export function assertKnownDocumentType(documentType: string): void {
  const valid = listSpecDocumentTypes();
  if (valid.includes(documentType)) return;
  throw unknownValueError({
    subject: "document type",
    value: documentType,
    candidates: valid,
    knownLabel: "Valid types",
  });
}

type ActionValidationFailure = {
  index: number;
  type: string;
  errors: string[];
};

function isActionValidationError(
  err: unknown,
): err is Error & { failures: ActionValidationFailure[] } {
  return (
    err instanceof Error &&
    Array.isArray((err as { failures?: unknown }).failures)
  );
}

/**
 * Pull the latest spec's operations from a document model schema. Each entry
 * has a `name` (SCREAMING_SNAKE_CASE) and a GraphQL `schema` for its input.
 */
function getLatestOperations(
  documentType: string,
): { name: string; schema?: string }[] {
  const schema = getDocumentModelSchema(documentType);
  const latest = schema.specifications.at(-1);
  const ops: { name: string; schema?: string }[] = [];
  for (const mod of latest?.modules ?? []) {
    for (const op of mod.operations ?? []) {
      if (op.name) ops.push({ name: op.name, schema: op.schema ?? undefined });
    }
  }
  return ops;
}

/**
 * Rethrow an `addActions` validation error with the relevant action input
 * schemas attached, so an agent caller can self-correct without a follow-up
 * `spec-schema` round-trip. For unknown action types, list the valid names.
 */
export function enrichActionValidationError(
  err: unknown,
  documentType: string,
): never {
  if (!isActionValidationError(err)) throw err;
  let ops: { name: string; schema?: string }[];
  try {
    ops = getLatestOperations(documentType);
  } catch {
    throw err;
  }
  const validNames = ops.map((o) => o.name);
  const shownSchemas = new Set<string>();
  const sections: string[] = [];
  let listedValidNames = false;
  for (const f of err.failures) {
    const op = ops.find((o) => o.name === f.type);
    if (op?.schema && !shownSchemas.has(op.name)) {
      shownSchemas.add(op.name);
      sections.push(`Input schema for ${op.name}:\n${op.schema}`);
    } else if (!op && !listedValidNames) {
      listedValidNames = true;
      /* Lead with the closest matches per failed type so the agent can fix
       * the typo without scanning the whole list. */
      const suggestions = new Set<string>();
      for (const g of err.failures) {
        if (!ops.find((o) => o.name === g.type)) {
          for (const s of suggestNames(g.type, validNames)) suggestions.add(s);
        }
      }
      const hint =
        suggestions.size > 0
          ? `Did you mean: ${[...suggestions].join(", ")}?\n`
          : "";
      sections.push(
        `${hint}Valid action types for ${documentType}:\n  ${validNames.join(", ")}`,
      );
    }
  }
  if (sections.length === 0) throw err;
  const enriched = new Error(`${err.message}\n\n${sections.join("\n\n")}`);
  (enriched as { failures?: ActionValidationFailure[] }).failures = err.failures;
  throw enriched;
}

/** Load a spec by name and return the document — convenience wrapper. */
export async function loadByName(
  workdir: string,
  name: string,
): Promise<PHDocument> {
  const { path } = await findByName(workdir, name);
  return getDocument(path);
}
