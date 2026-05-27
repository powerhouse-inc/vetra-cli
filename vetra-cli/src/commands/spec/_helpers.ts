import { randomUUID } from "node:crypto";
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

/* Pull the structured zod issues out of an `addActions` failure string. The
 * upstream wraps them as `Input validation error: Invalid action input: [<json>]`;
 * everything else (reducer errors like a bad operation name) has no embedded
 * array and is returned as-is by the caller. */
function parseZodIssues(
  errStr: string,
): { path: string; message: string }[] | null {
  const start = errStr.indexOf("[");
  const end = errStr.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(errStr.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.map((i) => {
    const issue = i as { path?: unknown; message?: unknown };
    return {
      path: Array.isArray(issue.path) ? issue.path.join(".") : "",
      message:
        typeof issue.message === "string"
          ? issue.message.replace(/^Invalid input:\s*/, "")
          : "invalid",
    };
  });
}

/* One compact line per failed action. `inputShape` is true when at least one
 * error was a zod input-validation issue (vs a reducer error), so the caller
 * knows whether attaching the input schema would help. */
function compactFailure(f: ActionValidationFailure): {
  line: string;
  inputShape: boolean;
} {
  const parts: string[] = [];
  let inputShape = false;
  for (const e of f.errors) {
    const issues = parseZodIssues(e);
    if (issues) {
      inputShape = true;
      for (const i of issues) parts.push(i.path ? `${i.path}: ${i.message}` : i.message);
    } else {
      parts.push(e.trim());
    }
  }
  return { line: `  [${f.index}] ${f.type}: ${parts.join("; ")}`, inputShape };
}

/**
 * Rethrow an `addActions` validation error in a compact, agent-actionable
 * form: one line per failed action with the offending fields, plus the input
 * schema for shape errors (so the agent can self-correct without a follow-up
 * `spec-schema` round-trip) and a did-you-mean list for unknown action types.
 * Replaces the upstream message's multi-line zod JSON dump.
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
  const headLines: string[] = [];
  let listedValidNames = false;
  for (const f of err.failures) {
    const op = ops.find((o) => o.name === f.type);
    const { line, inputShape } = compactFailure(f);
    headLines.push(line);
    if (!op && !listedValidNames) {
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
    } else if (op?.schema && inputShape && !shownSchemas.has(op.name)) {
      /* Only attach the schema for shape errors — a reducer error already
       * carries its own actionable message. */
      shownSchemas.add(op.name);
      sections.push(`Input schema for ${op.name}:\n${op.schema}`);
    }
  }
  const count = err.failures.length;
  const head = `${count} action${count === 1 ? "" : "s"} failed validation:\n${headLines.join("\n")}`;
  const message = sections.length ? `${head}\n\n${sections.join("\n\n")}` : head;
  const enriched = new Error(message);
  (enriched as { failures?: ActionValidationFailure[] }).failures = err.failures;
  throw enriched;
}

const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";

/* Input fields that reference an existing module or operation by id. A bare
 * `id` field means a different entity per operation (the module on
 * SET_MODULE_*, the operation on SET_OPERATION_*, but an *error* on
 * SET_OPERATION_ERROR_* — which must NOT be name-resolved), so the referent
 * can't be inferred from the schema and is listed explicitly here. Ops absent
 * from these maps are left untouched and fall through to reducer validation.
 * Keep in sync with the document-model operation set. */
const MODULE_REF_FIELDS: Record<string, string[]> = {
  ADD_OPERATION: ["moduleId"],
  MOVE_OPERATION: ["newModuleId"],
  REORDER_MODULE_OPERATIONS: ["moduleId"],
  SET_MODULE_NAME: ["id"],
  SET_MODULE_DESCRIPTION: ["id"],
  DELETE_MODULE: ["id"],
};
const OPERATION_REF_FIELDS: Record<string, string[]> = {
  MOVE_OPERATION: ["operationId"],
  ADD_OPERATION_ERROR: ["operationId"],
  ADD_OPERATION_EXAMPLE: ["operationId"],
  REORDER_OPERATION_ERRORS: ["operationId"],
  REORDER_OPERATION_EXAMPLES: ["operationId"],
  SET_OPERATION_NAME: ["id"],
  SET_OPERATION_SCHEMA: ["id"],
  SET_OPERATION_DESCRIPTION: ["id"],
  SET_OPERATION_TEMPLATE: ["id"],
  SET_OPERATION_REDUCER: ["id"],
  SET_OPERATION_SCOPE: ["id"],
  DELETE_OPERATION: ["id"],
};

/** Known ids plus a name→ids index for one entity kind (modules or operations). */
type EntityIndex = { ids: Set<string>; byName: Map<string, string[]> };

function strVal(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? { ...(input as Record<string, unknown>) }
    : {};
}

function addEntity(index: EntityIndex, id: unknown, name: unknown): void {
  const sid = strVal(id);
  if (!sid) return;
  index.ids.add(sid);
  const sname = strVal(name);
  if (!sname) return;
  const bucket = index.byName.get(sname);
  if (bucket) bucket.push(sid);
  else index.byName.set(sname, [sid]);
}

/**
 * Index modules and operations of a document-model doc by id and by name.
 * Seeds from the latest spec's on-disk state and from ADD_MODULE /
 * ADD_OPERATION actions earlier in the same batch, so a create-then-reference
 * sequence in a single `spec-update` call resolves.
 */
function collectEntities(
  doc: PHDocument,
  actions: ActionInput[],
): { modules: EntityIndex; operations: EntityIndex } {
  const modules: EntityIndex = { ids: new Set(), byName: new Map() };
  const operations: EntityIndex = { ids: new Set(), byName: new Map() };
  const specs = (doc.state as { global?: { specifications?: unknown[] } }).global
    ?.specifications;
  const latest = Array.isArray(specs) ? specs.at(-1) : undefined;
  const mods = (latest as { modules?: unknown[] } | undefined)?.modules ?? [];
  for (const m of mods as Array<{ id?: unknown; name?: unknown; operations?: unknown[] }>) {
    addEntity(modules, m?.id, m?.name);
    for (const op of (m?.operations ?? []) as Array<{ id?: unknown; name?: unknown }>) {
      addEntity(operations, op?.id, op?.name);
    }
  }
  for (const a of actions) {
    const input = asRecord(a.input);
    if (a.type === "ADD_MODULE") addEntity(modules, input.id, input.name);
    else if (a.type === "ADD_OPERATION") addEntity(operations, input.id, input.name);
  }
  return { modules, operations };
}

/* Default a required `scope` and mint a missing creation `id`, both keyed off
 * the operation's own input schema so the rule extends to any op following the
 * same `scope: String!` / `id: ID!` convention. */
function fillScopeAndId(
  action: ActionInput,
  opsByName: Map<string, string | undefined>,
): ActionInput {
  const schema = opsByName.get(action.type);
  if (!schema) return action;
  const input = asRecord(action.input);
  let changed = false;
  if (/\bscope\s*:\s*String!/.test(schema) && !strVal(input.scope)) {
    input.scope = strVal(action.scope) ?? "global";
    changed = true;
  }
  if (
    action.type.startsWith("ADD_") &&
    /\bid\s*:\s*ID!/.test(schema) &&
    !strVal(input.id)
  ) {
    input.id = randomUUID();
    changed = true;
  }
  return changed ? { ...action, input } : action;
}

function resolveField(
  input: Record<string, unknown>,
  field: string,
  index: EntityIndex,
  opType: string,
  kind: string,
): boolean {
  const value = strVal(input[field]);
  if (!value || index.ids.has(value)) return false;
  const matches = index.byName.get(value);
  if (!matches || matches.length === 0) return false;
  if (matches.length > 1) {
    throw new Error(
      `${opType}: ${kind} name "${value}" matches multiple ${kind}s (ids: ${matches.join(", ")}). Re-issue "${field}" with the specific id.`,
    );
  }
  input[field] = matches[0];
  return true;
}

function resolveReferences(
  action: ActionInput,
  index: { modules: EntityIndex; operations: EntityIndex },
): ActionInput {
  const moduleFields = MODULE_REF_FIELDS[action.type];
  const operationFields = OPERATION_REF_FIELDS[action.type];
  if (!moduleFields && !operationFields) return action;
  const input = asRecord(action.input);
  let changed = false;
  for (const f of moduleFields ?? []) {
    changed = resolveField(input, f, index.modules, action.type, "module") || changed;
  }
  for (const f of operationFields ?? []) {
    changed =
      resolveField(input, f, index.operations, action.type, "operation") || changed;
  }
  return changed ? { ...action, input } : action;
}

/**
 * Smooth over the three recurring agent foot-guns on document-model specs,
 * before the actions reach the reducer:
 *   - a required payload `scope` left off SET_STATE_SCHEMA / SET_INITIAL_STATE
 *     and the *_STATE_EXAMPLE family → defaulted to the action scope or "global";
 *   - a missing creation `id` on an ADD_* op → minted as a UUID;
 *   - a module/operation reference given as a name instead of an id → resolved
 *     against current + in-batch entities, throwing if a name is ambiguous.
 * Non-document-model docs pass through untouched.
 */
export function normalizeDocumentModelActions(
  doc: PHDocument,
  actions: ActionInput[],
): ActionInput[] {
  if (doc.header.documentType !== DOCUMENT_MODEL_TYPE) return actions;
  let opsByName: Map<string, string | undefined>;
  try {
    opsByName = new Map(
      getLatestOperations(DOCUMENT_MODEL_TYPE).map((o) => [o.name, o.schema]),
    );
  } catch {
    return actions;
  }
  const filled = actions.map((a) => fillScopeAndId(a, opsByName));
  const index = collectEntities(doc, filled);
  return filled.map((a) => resolveReferences(a, index));
}

/** Load a spec by name and return the document — convenience wrapper. */
export async function loadByName(
  workdir: string,
  name: string,
): Promise<PHDocument> {
  const { path } = await findByName(workdir, name);
  return getDocument(path);
}
