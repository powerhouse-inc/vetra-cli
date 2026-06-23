import { type DocumentNode, Kind, parse, visit } from "graphql";

/* Leaf module for document-model-specific SDL analysis shared by the spec
 * command pipeline (`registry.ts` apply path) and the SDL validators
 * (`_helpers.ts`). Kept dependency-free of both so either can import it without
 * a cycle. */

export const DOCUMENT_MODEL_TYPE = "powerhouse/document-model";

/* Shape of a document-model document's materialized state, narrowed to the
 * fields the spec tooling reads. Both the apply path and the validators reach
 * into the latest specification's per-scope state schemas and operation SDL;
 * defined once here so the cast literal isn't hand-rolled at every call site. */
type StateSchemas = {
  global?: { schema?: string | null };
  local?: { schema?: string | null };
};
type Operation = {
  id?: string | null;
  name?: string | null;
  scope?: string | null;
  schema?: string | null;
};
type Module = {
  id?: string | null;
  name?: string | null;
  operations?: Operation[];
};
export type DocumentModelSpecification = {
  state?: StateSchemas;
  modules?: Module[];
};
export type DocumentModelGlobalState = {
  name?: string | null;
  specifications?: DocumentModelSpecification[];
};

/** The `state.global` object of a document-model document, or undefined. */
export function documentModelState(
  state: unknown,
): DocumentModelGlobalState | undefined {
  return (state as { global?: DocumentModelGlobalState } | null | undefined)
    ?.global;
}

/** The latest specification entry of a document-model document, or undefined. */
export function latestSpecification(
  state: unknown,
): DocumentModelSpecification | undefined {
  return documentModelState(state)?.specifications?.at(-1);
}

/* Type-system definition kinds GraphQL requires to be uniquely named. A name
 * defined twice across a document model's scopes produces duplicate subgraph
 * SDL that crashes the federated gateway (Sentry #917). */
const TYPE_DEFINITION_KINDS = new Set<string>([
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
  Kind.SCALAR_TYPE_DEFINITION,
]);

const TYPE_EXTENSION_KINDS = new Set<string>([
  Kind.OBJECT_TYPE_EXTENSION,
  Kind.ENUM_TYPE_EXTENSION,
  Kind.INPUT_OBJECT_TYPE_EXTENSION,
  Kind.INTERFACE_TYPE_EXTENSION,
  Kind.UNION_TYPE_EXTENSION,
  Kind.SCALAR_TYPE_EXTENSION,
]);

/** Parse an SDL fragment, or null when it is empty or not valid GraphQL (e.g. a
 * still-in-progress scope, or TS pseudo-SDL `type X = { ... }`). A null result
 * means "skip", never "error" — malformed SDL falls through to the codegen's
 * own parse error rather than being mis-reported here. */
export function parseSdl(sdl: string | null | undefined): DocumentNode | null {
  if (!sdl || !sdl.trim()) return null;
  try {
    return parse(sdl);
  } catch {
    return null;
  }
}

/** Type names DECLARED in a parsed SDL fragment. `includeExtensions` also counts
 * `extend type X` — wanted when resolving references (an extended type is a
 * legitimate referent), unwanted for the duplicate check (an extension is not a
 * redefinition). */
export function declaredTypeNames(
  ast: DocumentNode,
  opts: { includeExtensions?: boolean } = {},
): Set<string> {
  const names = new Set<string>();
  for (const def of ast.definitions) {
    const counts =
      TYPE_DEFINITION_KINDS.has(def.kind) ||
      (opts.includeExtensions && TYPE_EXTENSION_KINDS.has(def.kind));
    if (!counts) continue;
    const name = (def as { name?: { value: string } }).name?.value;
    if (name) names.add(name);
  }
  return names;
}

/* Action types whose payload carries an SDL schema that can introduce a type
 * definition. A batch with none of these cannot create a duplicate, so the
 * duplicate guard (and, on the preview path, the round-trip it needs) can be
 * skipped — and an unrelated edit (e.g. SET_MODEL_NAME) is never blocked by a
 * pre-existing duplicate. */
const SCHEMA_ACTION_TYPES = new Set<string>([
  "SET_STATE_SCHEMA",
  "ADD_OPERATION",
  "SET_OPERATION_SCHEMA",
]);

/** Whether any action in the batch can introduce a type definition. */
export function batchTouchesTypeDefinitions(
  actions: ReadonlyArray<{ type?: string | null }>,
): boolean {
  return actions.some((a) => !!a.type && SCHEMA_ACTION_TYPES.has(a.type));
}

/** Every type name REFERENCED in a parsed SDL fragment — field/argument types,
 * union members, and `implements` interfaces alike. Walks named-type nodes so
 * union/implements references aren't missed (a `:`-anchored regex would). */
export function referencedTypeNames(ast: DocumentNode): Set<string> {
  const names = new Set<string>();
  visit(ast, {
    NamedType(node) {
      names.add(node.name.value);
    },
  });
  return names;
}
