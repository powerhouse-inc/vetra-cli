import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Kind, parse } from "graphql";
import {
  getDocumentModels as getBuiltinModels,
  getDocumentModelSchema as getBuiltinSchema,
  getSpecEntry as getBuiltinSpecEntry,
  listSpecDocumentTypes as listBuiltinTypes,
} from "@powerhousedao/vetra/codegen";
import { baseLoadFromFile, baseSaveToFile } from "document-model/node";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { documentModels as vetraAppModels } from "vetra-app";

/* The codegen package owns a private registry of five Powerhouse builder spec
 * types (document-model, editor, app, processor, subgraph) and resolves every
 * spec operation through it. vetra-app ships its own domain document models
 * (Feature, Audience Sheet, …) as `DocumentModelModule`s. This module merges
 * those into the builder set so the spec tools can CRUD instances of them in a
 * reactor-project's `specs/` tree. Codegen exposes no registration hook, so the
 * spec operations are reimplemented here over a unified entry resolver. */

type DocumentModelInfo = {
  type: string;
  name: string;
  description: string;
  extension: string;
  authorName: string;
  authorWebsite: string;
};

type SpecModule = {
  name?: string | null;
  operations?: { name?: string | null; scope?: string; schema?: string | null }[];
};
type Specification = { version?: number; modules?: SpecModule[] };

type JsonSpec = {
  id: string;
  name: string;
  description?: string;
  extension?: string;
  author?: { name?: string; website?: string };
  specifications: Specification[];
};

type ActionsModule = Record<string, (input?: unknown) => Record<string, unknown>>;

type SpecEntry = {
  documentType: string;
  subdir: string;
  reducer: (doc: PHDocument, action: unknown) => PHDocument;
  utils: { fileExtension: string; createDocument: (state?: unknown) => PHDocument };
  actions: ActionsModule;
  createDocument: (state?: unknown) => PHDocument;
  jsonSpec: JsonSpec;
};

export type ActionInput = { type: string; input?: unknown; scope?: string };

const SPECS_DIRNAME = "specs";

/* Entries derived from vetra-app's document model modules. Each module exposes
 * the same surface a codegen `SpecEntry` needs: a reducer, action creators,
 * utils (createDocument + fileExtension), and the model definition at
 * `documentModel.global`. Subdir is the id's last segment so it never collides
 * with a builder subdir. */
const vetraAppEntries: Map<string, SpecEntry> = new Map(
  (vetraAppModels as unknown as ReadonlyArray<{
    reducer: SpecEntry["reducer"];
    actions: ActionsModule;
    utils: SpecEntry["utils"];
    documentModel: { global: JsonSpec };
  }>).map((mod) => {
    const jsonSpec = mod.documentModel.global;
    const entry: SpecEntry = {
      documentType: jsonSpec.id,
      subdir: jsonSpec.id.split("/").pop() || kebabCase(jsonSpec.name),
      reducer: mod.reducer,
      utils: mod.utils,
      actions: mod.actions,
      createDocument: mod.utils.createDocument,
      jsonSpec,
    };
    return [entry.documentType, entry] as const;
  }),
);

/** Resolve a spec type to its handler. vetra-app domain types win over the
 * builder set on the (currently impossible) chance of an id clash. Throws via
 * codegen for any unknown builder type. */
export function resolveSpecEntry(documentType: string): SpecEntry {
  const local = vetraAppEntries.get(documentType);
  if (local) return local;
  return getBuiltinSpecEntry(documentType) as unknown as SpecEntry;
}

/** All known spec types: builder set + vetra-app domain models. */
export function listSpecTypes(): string[] {
  return [...listBuiltinTypes(), ...vetraAppEntries.keys()];
}

export type SpecCategory = "product" | "project";

/** Product specs: vetra-app ideation domain models (brand/problem/audience
 * sheets, feature, work-breakdown-structure). Project specs: the Powerhouse
 * builder set (document-model, editor, app, processor, subgraph). */
export function listSpecTypesByCategory(category: SpecCategory): string[] {
  return category === "product"
    ? [...vetraAppEntries.keys()]
    : [...listBuiltinTypes()];
}

/** True for vetra-app ideation types (product specs). */
export function isProductSpecType(documentType: string): boolean {
  return vetraAppEntries.has(documentType);
}

/** Directory holding specs for a given type: `<projectDir>/specs/<subdir>`. */
export function specDir(projectDir: string, documentType: string): string {
  return join(projectDir, SPECS_DIRNAME, resolveSpecEntry(documentType).subdir);
}

/** Create an in-memory spec document. The caller persists it with `saveSpec`. */
export function createSpecDocument(
  documentType: string,
  opts: { name?: string; initialState?: unknown } = {},
): PHDocument {
  const doc = resolveSpecEntry(documentType).createDocument(opts.initialState);
  if (opts.name) doc.header.name = opts.name;
  return doc;
}

/** Persist a spec to `<projectDir>/specs/<subdir>/<kebab-name>.<ext>.phd`. */
export async function saveSpec(doc: PHDocument, projectDir: string): Promise<string> {
  const entry = resolveSpecEntry(doc.header.documentType);
  const dir = join(projectDir, SPECS_DIRNAME, entry.subdir);
  await mkdir(dir, { recursive: true });
  const name = kebabCase(doc.header.name || "untitled");
  return baseSaveToFile(doc, dir, stripLeadingDot(entry.utils.fileExtension), name);
}

/** Load a spec from disk. The subdir hints which reducer to try first; falls
 * back to every registered reducer so a moved file still loads. */
export async function loadSpecDocument(path: string): Promise<PHDocument> {
  const subdir = pathSubdir(path);
  const hint = subdir
    ? listSpecTypes().find((t) => resolveSpecEntry(t).subdir === subdir)
    : undefined;
  const order = hint
    ? [hint, ...listSpecTypes().filter((t) => t !== hint)]
    : listSpecTypes();
  let lastError: unknown;
  for (const documentType of order) {
    try {
      return await baseLoadFromFile(path, resolveSpecEntry(documentType).reducer as never);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Failed to load spec at "${path}": no registered reducer accepted it. Last error: ${String(lastError)}`,
  );
}

/** Load every spec under the project's `specs/` tree. Narrow with
 * `documentType` (one type) or `category` (product vs project family). */
export async function getSpecDocuments(
  projectDir: string,
  opts: { documentType?: string; category?: SpecCategory } = {},
): Promise<PHDocument[]> {
  const types = opts.documentType
    ? [opts.documentType]
    : opts.category
      ? listSpecTypesByCategory(opts.category)
      : listSpecTypes();
  const out: PHDocument[] = [];
  for (const documentType of types) {
    const dir = specDir(projectDir, documentType);
    if (!(await stat(dir).then((s) => s.isDirectory(), () => false))) continue;
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith(".phd")) continue;
      out.push(await loadSpecDocument(join(dir, entry)));
    }
  }
  return out;
}

const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";

/* Type-system definition kinds that GraphQL requires to be uniquely named. A
 * name defined twice across a document model's scopes produces duplicate
 * subgraph SDL that crashes the federated gateway (Sentry #917). */
const TYPE_DEFINITION_KINDS = new Set<string>([
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
  Kind.SCALAR_TYPE_DEFINITION,
]);

/** Find type/enum/input/interface/union/scalar names defined in more than one
 * place across the latest specification of a document-model document — global
 * state schema, local state schema, and every operation schema. References are
 * not definitions, so legitimately-referenced types do not false-positive;
 * unparseable SDL (a still-in-progress scope) is skipped, not treated as an
 * error. */
export function findDuplicateTypeDefinitions(
  doc: PHDocument,
): { name: string; sites: string[] }[] {
  const dmState = (
    doc.state as {
      global?: {
        specifications?: {
          state?: {
            global?: { schema?: string | null };
            local?: { schema?: string | null };
          };
          modules?: {
            operations?: { name?: string | null; schema?: string | null }[];
          }[];
        }[];
      };
    }
  ).global;
  const latest = dmState?.specifications?.at(-1);
  if (!latest) return [];

  const sources: { label: string; sdl?: string | null }[] = [
    { label: "the global state schema", sdl: latest.state?.global?.schema },
    { label: "the local state schema", sdl: latest.state?.local?.schema },
  ];
  for (const mod of latest.modules ?? []) {
    for (const op of mod.operations ?? []) {
      sources.push({
        label: `operation "${op.name ?? "?"}"`,
        sdl: op.schema,
      });
    }
  }

  const sites = new Map<string, string[]>();
  for (const { label, sdl } of sources) {
    if (!sdl || !sdl.trim()) continue;
    let ast;
    try {
      ast = parse(sdl);
    } catch {
      continue;
    }
    for (const def of ast.definitions) {
      if (!TYPE_DEFINITION_KINDS.has(def.kind)) continue;
      const name = (def as { name?: { value: string } }).name?.value;
      if (!name) continue;
      sites.set(name, [...(sites.get(name) ?? []), label]);
    }
  }

  return [...sites.entries()]
    .filter(([, s]) => s.length > 1)
    .map(([name, s]) => ({ name, sites: s }));
}

/** Validate then apply actions in order via the type's reducer. On any invalid
 * action throws an aggregated error (with `.failures`) and leaves `doc`
 * untouched. For document models, also rejects a result that defines the same
 * type/enum name in more than one place (Sentry #917) before it can be saved. */
export function applyActions(doc: PHDocument, actions: ActionInput[]): PHDocument {
  const entry = resolveSpecEntry(doc.header.documentType);
  const built = validateAndBuildActions(entry, actions);
  let current = doc;
  for (let i = 0; i < built.length; i++) {
    current = entry.reducer(current, built[i]);
    const scope = (built[i] as { scope?: string }).scope ?? "global";
    const ops = (current.operations as Record<string, { error?: string }[]>)[scope];
    const last = ops?.[ops.length - 1];
    if (last?.error) {
      throw formatValidationError([
        { index: i, type: actions[i].type ?? "<missing>", errors: [`Reducer error: ${last.error}`] },
      ]);
    }
  }

  if (entry.documentType === DOCUMENT_MODEL_TYPE) {
    const duplicates = findDuplicateTypeDefinitions(current);
    if (duplicates.length > 0) {
      const details = duplicates
        .map((d) => {
          // Collapse repeated sites (e.g. a name defined twice in one schema)
          // into "<site> (N times)" so the message reads cleanly.
          const counts = new Map<string, number>();
          for (const s of d.sites) counts.set(s, (counts.get(s) ?? 0) + 1);
          const where = [...counts.entries()]
            .map(([site, n]) => (n > 1 ? `${site} (${n} times)` : site))
            .join(" and ");
          return `"${d.name}" is defined in ${where}`;
        })
        .join("; ");
      throw new Error(
        `Duplicate type/enum name(s) in this document model: ${details}. ` +
          `Every type, enum, input, interface, and union name must be unique across the global state schema, ` +
          `the local state schema, and all operation schemas. Reference the existing type by name instead of ` +
          `redefining it, or rename one (e.g. OrderStatus vs MenuItemStatus).`,
      );
    }
  }

  return current;
}

/** Document-model definition for a type — schema, operations, errors. */
export function getSpecSchema(documentType: string): JsonSpec {
  const local = vetraAppEntries.get(documentType);
  return local ? local.jsonSpec : (getBuiltinSchema(documentType) as unknown as JsonSpec);
}

/** Type rows for `spec-schema-list`: vetra-app domain models then builders. */
export function listSpecModels(): DocumentModelInfo[] {
  const vetra = [...vetraAppEntries.values()].map((e) => ({
    type: e.jsonSpec.id,
    name: e.jsonSpec.name,
    description: e.jsonSpec.description ?? "",
    extension: e.jsonSpec.extension ?? "",
    authorName: e.jsonSpec.author?.name ?? "",
    authorWebsite: e.jsonSpec.author?.website ?? "",
  }));
  return [...vetra, ...getBuiltinModels()];
}

type ActionValidationFailure = { index: number; type: string; errors: string[] };

function validateAndBuildActions(
  entry: SpecEntry,
  actions: ActionInput[],
): Record<string, unknown>[] {
  const built: Record<string, unknown>[] = [];
  const failures: ActionValidationFailure[] = [];
  for (let i = 0; i < actions.length; i++) {
    const item = actions[i];
    const errors = collectActionErrors(entry, item);
    if (errors.length > 0) {
      failures.push({ index: i, type: item.type ?? "<missing>", errors });
      continue;
    }
    built.push(buildAction(entry.actions, item));
  }
  if (failures.length > 0) throw formatValidationError(failures);
  return built;
}

function collectActionErrors(entry: SpecEntry, item: ActionInput): string[] {
  const errors: string[] = [];
  if (typeof item.type !== "string" || item.type.length === 0) {
    errors.push("Missing `type` field");
    return errors;
  }
  const specs = entry.jsonSpec.specifications;
  if (!specs || specs.length === 0) {
    errors.push("Document model has no specifications");
    return errors;
  }
  const latest = specs[specs.length - 1];
  let operation: { name?: string | null; scope?: string } | undefined;
  for (const module of latest.modules ?? []) {
    const found = (module.operations ?? []).find((op) => op.name === item.type);
    if (found) {
      operation = found;
      break;
    }
  }
  if (!operation) {
    errors.push(`Operation "${item.type}" is not defined in any module of the document model`);
  }
  const creator = entry.actions[camelCase(item.type)];
  if (!creator) {
    errors.push("No action creator found.");
  } else {
    try {
      creator(item.input);
    } catch (err) {
      errors.push(`Input validation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (operation?.scope && item.scope && item.scope !== operation.scope) {
    errors.push(`Scope "${item.scope}" does not match operation scope "${operation.scope}"`);
  }
  return errors;
}

function buildAction(actionsModule: ActionsModule, item: ActionInput): Record<string, unknown> {
  const creator = actionsModule[camelCase(item.type)];
  if (!creator) {
    throw new Error(`No action creator found for "${item.type}" (looked up as "${camelCase(item.type)}")`);
  }
  const action = creator(item.input);
  if (item.scope) action.scope = item.scope;
  return action;
}

function formatValidationError(failures: ActionValidationFailure[]): Error {
  const lines = failures.map((f) => `  [${f.index}] ${f.type}: ${f.errors.join("; ")}`);
  const header =
    failures.length === 1 ? "1 action failed validation:" : `${failures.length} actions failed validation:`;
  const err = new Error([header, ...lines].join("\n")) as Error & {
    failures: ActionValidationFailure[];
  };
  err.failures = failures;
  return err;
}

function pathSubdir(filePath: string): string | undefined {
  const parts = filePath.split(/[/\\]/);
  const i = parts.lastIndexOf(SPECS_DIRNAME);
  if (i < 0 || i + 1 >= parts.length) return undefined;
  return parts[i + 1];
}

function stripLeadingDot(ext: string): string {
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

function kebabCase(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
}

function camelCase(s: string): string {
  const parts = s
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}
