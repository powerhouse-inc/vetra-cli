/**
 * The product's example documents (designer's call D21, "Seeding").
 *
 * In the Tests step the agent writes a small starter set — taken from its
 * preview sample data — as `seed/<document-type>.json` files at the root of
 * the reactor project. Each file names one document type and lists a few
 * documents, each a name starting with `Example — delete me` plus the
 * operations that fill it:
 *
 *     {
 *       "documentType": "acme/todo-list",
 *       "documents": [
 *         {
 *           "name": "Example — delete me: Weekend chores",
 *           "actions": [{ "type": "ADD_TODO", "input": { "id": "t1", "title": "Buy milk" } }]
 *         }
 *       ]
 *     }
 *
 * `validateSeeds` checks the files against the project's own document models
 * (type known, operation known, input fits the operation's input schema) and
 * is part of SMOKE (`seedCheck`), so the starter set is checked like
 * everything else. At the first launch `ensureProductDrive` (product-drive.ts)
 * creates these documents once in the product drive.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildASTSchema,
  coerceInputValue,
  GraphQLNonNull,
  isInputObjectType,
  Kind,
  parse,
  visit,
  type DocumentNode,
  type GraphQLSchema,
} from "graphql";
import { capReason, type ObservedCheck } from "../product/check-results.js";

export const SEED_DIR = "seed";
export const EXAMPLE_PREFIX = "Example — delete me";
/** A small starter set: more than this per file is refused. */
export const MAX_SEED_DOCUMENTS = 10;
export const MAX_SEED_ACTIONS = 100;

export interface SeedAction {
  type: string;
  input: Record<string, unknown>;
  /** The operation's scope from the model (the file may omit it). */
  scope: string;
}

export interface SeedDocument {
  /** `seed/<file>.json#<index>` — stable while the files don't change. */
  key: string;
  file: string;
  documentType: string;
  name: string;
  actions: SeedAction[];
}

export interface SeedProblem {
  file: string;
  /** The document's name when the problem is inside one document. */
  document?: string;
  message: string;
}

export interface SeedValidation {
  documents: SeedDocument[];
  problems: SeedProblem[];
  /** Document types the project defines. */
  modelTypes: string[];
}

interface OperationInfo {
  scope: string;
  inputType: string | null;
}

interface ModelInfo {
  documentType: string;
  operations: Map<string, OperationInfo>;
  /** Null when the model's SDL couldn't be assembled; inputs are then not checked. */
  schema: GraphQLSchema | null;
}

interface SpecJson {
  id?: unknown;
  specifications?: Array<{
    state?: Record<string, { schema?: string | null } | undefined>;
    modules?: Array<{
      operations?: Array<{ name?: string | null; scope?: string | null; schema?: string | null }>;
    }>;
  }>;
}

const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

function pascal(opName: string): string {
  return opName
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** Every type the SDL names but doesn't define becomes a permissive scalar (OID, DateTime, …). */
function withMissingScalars(ast: DocumentNode): DocumentNode {
  const defined = new Set<string>();
  const referenced = new Set<string>();
  for (const def of ast.definitions) {
    if ("name" in def && def.name && def.kind !== Kind.OPERATION_DEFINITION) defined.add(def.name.value);
  }
  visit(ast, {
    NamedType(node) {
      referenced.add(node.name.value);
    },
  });
  const missing = [...referenced].filter((n) => !defined.has(n) && !BUILTIN_SCALARS.has(n));
  const sdl = missing.map((n) => `scalar ${n}`).join("\n");
  const extra = sdl ? parse(sdl).definitions : [];
  const hasQuery = defined.has("Query");
  const query = hasQuery ? [] : parse("type Query { _seed: Boolean }").definitions;
  return { ...ast, definitions: [...ast.definitions, ...extra, ...query] };
}

function buildModelSchema(spec: NonNullable<SpecJson["specifications"]>[number]): GraphQLSchema | null {
  const parts: string[] = [];
  for (const scope of Object.values(spec.state ?? {})) if (scope?.schema) parts.push(scope.schema);
  for (const mod of spec.modules ?? []) {
    for (const op of mod.operations ?? []) if (op.schema) parts.push(op.schema);
  }
  if (parts.length === 0) return null;
  try {
    const ast = withMissingScalars(parse(parts.join("\n")));
    return buildASTSchema(ast, { assumeValid: true, assumeValidSDL: true });
  } catch {
    return null;
  }
}

function firstInputTypeName(sdl: string | null | undefined): string | null {
  if (!sdl) return null;
  try {
    const def = parse(sdl).definitions.find((d) => d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION);
    return def && "name" in def && def.name ? def.name.value : null;
  } catch {
    return null;
  }
}

/** The project's document models, read from `document-models/<name>/<name>.json`. */
export function loadProjectModels(projectPath: string): Map<string, ModelInfo> {
  const models = new Map<string, ModelInfo>();
  const root = path.join(projectPath, "document-models");
  if (!fs.existsSync(root)) return models;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json") || file === "package.json" || file.startsWith("tsconfig")) continue;
      let json: SpecJson;
      try {
        json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as SpecJson;
      } catch {
        continue;
      }
      const spec = json.specifications?.at(-1);
      if (typeof json.id !== "string" || !spec) continue;
      const operations = new Map<string, OperationInfo>();
      for (const mod of spec.modules ?? []) {
        for (const op of mod.operations ?? []) {
          if (!op.name) continue;
          operations.set(op.name, {
            scope: op.scope ?? "global",
            inputType: firstInputTypeName(op.schema) ?? `${pascal(op.name)}Input`,
          });
        }
      }
      models.set(json.id, { documentType: json.id, operations, schema: buildModelSchema(spec) });
    }
  }
  return models;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Check one action's input against the operation's input type; returns the first problem. */
function inputProblem(model: ModelInfo, op: OperationInfo, input: unknown): string | null {
  if (!model.schema || !op.inputType) return null;
  const type = model.schema.getType(op.inputType);
  if (!type || !isInputObjectType(type)) return null;
  const errors: string[] = [];
  coerceInputValue(input, new GraphQLNonNull(type), (p, _value, error) => {
    const at = p.length > 0 ? `${p.join(".")}: ` : "";
    errors.push(`${at}${error.message}`);
  });
  return errors[0] ?? null;
}

/**
 * Read `seed/*.json` and check every document against the project's models.
 * Documents with a problem are left out of `documents`.
 */
export function validateSeeds(projectPath: string): SeedValidation {
  const models = loadProjectModels(projectPath);
  const documents: SeedDocument[] = [];
  const problems: SeedProblem[] = [];
  const dir = path.join(projectPath, SEED_DIR);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    : [];

  for (const name of files) {
    const file = `${SEED_DIR}/${name}`;
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
    } catch (err) {
      problems.push({ file, message: `not valid JSON (${err instanceof Error ? err.message : String(err)})` });
      continue;
    }
    if (!isRecord(json) || typeof json.documentType !== "string" || !Array.isArray(json.documents)) {
      problems.push({ file, message: 'expected { "documentType": string, "documents": [...] }' });
      continue;
    }
    const documentType = json.documentType;
    const model = models.get(documentType);
    if (!model) {
      problems.push({
        file,
        message: `unknown document type "${json.documentType}" (this project defines: ${[...models.keys()].join(", ") || "none"})`,
      });
      continue;
    }
    if (json.documents.length === 0) {
      problems.push({ file, message: "lists no documents" });
      continue;
    }
    if (json.documents.length > MAX_SEED_DOCUMENTS) {
      problems.push({ file, message: `lists ${json.documents.length} documents; keep it to ${MAX_SEED_DOCUMENTS} or fewer` });
      continue;
    }

    json.documents.forEach((doc: unknown, index: number) => {
      const docName = isRecord(doc) && typeof doc.name === "string" ? doc.name : `document ${index + 1}`;
      const fail = (message: string) => problems.push({ file, document: docName, message });
      if (!isRecord(doc) || typeof doc.name !== "string" || !Array.isArray(doc.actions)) {
        fail('expected { "name": string, "actions": [...] }');
        return;
      }
      if (!doc.name.startsWith(EXAMPLE_PREFIX)) {
        fail(`the name must start with "${EXAMPLE_PREFIX}"`);
        return;
      }
      if (doc.actions.length > MAX_SEED_ACTIONS) {
        fail(`has ${doc.actions.length} actions; keep it to ${MAX_SEED_ACTIONS} or fewer`);
        return;
      }
      const actions: SeedAction[] = [];
      for (const [i, raw] of doc.actions.entries()) {
        const at = `action ${i + 1}`;
        if (!isRecord(raw) || typeof raw.type !== "string") {
          fail(`${at}: expected { "type": string, "input": {...} }`);
          return;
        }
        const op = model.operations.get(raw.type);
        if (!op) {
          fail(`${at}: ${documentType} has no operation ${raw.type}`);
          return;
        }
        if (raw.scope !== undefined && raw.scope !== op.scope) {
          fail(`${at}: ${raw.type} is a ${op.scope} operation, not ${JSON.stringify(raw.scope)}`);
          return;
        }
        const input = raw.input ?? {};
        if (!isRecord(input)) {
          fail(`${at}: ${raw.type} input must be an object`);
          return;
        }
        const problem = inputProblem(model, op, input);
        if (problem) {
          fail(`${at} ${raw.type}: ${problem}`);
          return;
        }
        actions.push({ type: raw.type, input, scope: op.scope });
      }
      documents.push({
        key: `${file}#${index}`,
        file,
        documentType,
        name: doc.name,
        actions,
      });
    });
  }
  return { documents, problems, modelTypes: [...models.keys()] };
}

/**
 * The SMOKE part for the starter set. `check` is a failing SMOKE result when
 * a seed file doesn't fit the models (the reason names the document), or when
 * examples are required (`requireExamples`: the workspace has a product
 * document, Ruling X27) and the project defines document types but has none.
 * Without that requirement, missing examples only give a `note`.
 */
export function seedCheck(
  projectPath: string,
  opts: { requireExamples?: boolean } = {},
): { check: ObservedCheck | null; note?: string } {
  const { documents, problems, modelTypes } = validateSeeds(projectPath);
  if (problems.length > 0) {
    const first = problems[0];
    const what = first.document ? `"${first.document}"` : first.file;
    const reason =
      problems.length === 1
        ? `An example document doesn't fit the app: ${what}.`
        : `${problems.length} example documents don't fit the app, first: ${what}.`;
    const detail = problems
      .slice(0, 5)
      .map((p) => `${p.file}${p.document ? ` "${p.document}"` : ""}: ${p.message}`)
      .join("; ");
    return {
      check: {
        kind: "SMOKE",
        passed: false,
        reason: capReason(reason, { base: projectPath }),
        detail: `Example documents (${SEED_DIR}/*.json) don't fit the document models — ${detail}`,
      },
    };
  }
  if (modelTypes.length > 0 && documents.length === 0) {
    const hint = `write ${SEED_DIR}/<document-type>.json (load the example-data skill).`;
    if (!opts.requireExamples) return { check: null, note: `no example documents yet: ${hint}` };
    return {
      check: {
        kind: "SMOKE",
        passed: false,
        reason: "There are no example documents yet.",
        detail: `No example documents: ${hint}`,
      },
    };
  }
  return { check: null };
}
