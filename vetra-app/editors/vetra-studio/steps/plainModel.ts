/**
 * A data model in plain words (spec §5.2, Data step): "A Task has a title,
 * a due date, a status (To do, Doing, Done)" plus its operations as verbs.
 * Pure; reads the document-model document's global state structurally so
 * older or partial specs never throw.
 */
import {
  Kind,
  parse,
  type DocumentNode,
  type EnumTypeDefinitionNode,
  type FieldDefinitionNode,
  type ObjectTypeDefinitionNode,
  type TypeNode,
} from "graphql";

/** The parts of a `powerhouse/document-model` global state this reads. */
export interface ModelSpec {
  name?: string | null;
  specifications?: readonly {
    state?: { global?: { schema?: string | null } | null } | null;
    modules?: readonly {
      operations?: readonly { name?: string | null }[] | null;
    }[];
  }[];
}

export interface PlainModel {
  name: string;
  /** One sentence per data type, the model's own state first. */
  sentences: string[];
  /** What you can do with it: "Add task", "Set task title", … */
  verbs: string[];
  /** The raw schema, shown behind "Show schema". */
  schema: string;
}

/** "dueDate" / "DUE_DATE" / "DueDate" → ["due", "date"]. */
function words(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function withArticle(phrase: string): string {
  return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

function namedType(type: TypeNode): { name: string; list: boolean } {
  switch (type.kind) {
    case Kind.NON_NULL_TYPE:
      return namedType(type.type);
    case Kind.LIST_TYPE:
      return { name: namedType(type.type).name, list: true };
    default:
      return { name: type.name.value, list: false };
  }
}

function describeField(
  field: FieldDefinitionNode,
  enums: ReadonlyMap<string, EnumTypeDefinitionNode>,
): string | null {
  const name = field.name.value;
  if (name === "id") return null;
  const { name: typeName, list } = namedType(field.type);
  const phrase = words(name).join(" ");
  if (list) return phrase;
  if (typeName === "Boolean") {
    return `whether it is ${words(name.replace(/^is(?=[A-Z])/, "")).join(" ")}`;
  }
  const enumType = enums.get(typeName);
  if (enumType) {
    const values = (enumType.values ?? []).map((v) =>
      sentenceCase(words(v.name.value).join(" ")),
    );
    return values.length > 0
      ? `${withArticle(phrase)} (${values.join(", ")})`
      : withArticle(phrase);
  }
  return withArticle(phrase);
}

function describeType(
  label: string,
  type: ObjectTypeDefinitionNode,
  enums: ReadonlyMap<string, EnumTypeDefinitionNode>,
): string | null {
  const parts = (type.fields ?? [])
    .map((f) => describeField(f, enums))
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return `${withArticle(label)} has ${parts.join(", ")}`.replace(
    /^an? /,
    (article) => sentenceCase(article),
  );
}

function parseSchema(schema: string): DocumentNode | null {
  try {
    return parse(schema);
  } catch {
    return null;
  }
}

/** Plain words for one document model. */
export function plainModel(spec: ModelSpec): PlainModel {
  const latest = spec.specifications?.at(-1);
  const schema = latest?.state?.global?.schema ?? "";
  const modelName = spec.name?.trim() || "Data model";
  const verbs = (latest?.modules ?? [])
    .flatMap((m) => m.operations ?? [])
    .map((op) => op.name ?? "")
    .filter(Boolean)
    .map((name) => sentenceCase(words(name).join(" ")));

  const doc = parseSchema(schema);
  const enums = new Map<string, EnumTypeDefinitionNode>();
  const objects: ObjectTypeDefinitionNode[] = [];
  for (const def of doc?.definitions ?? []) {
    if (def.kind === Kind.ENUM_TYPE_DEFINITION) enums.set(def.name.value, def);
    if (def.kind === Kind.OBJECT_TYPE_DEFINITION) objects.push(def);
  }
  const isState = (t: ObjectTypeDefinitionNode) =>
    /State$/.test(t.name.value) && !/LocalState$/.test(t.name.value);
  const ordered = [
    ...objects.filter(isState),
    ...objects.filter((t) => !isState(t) && !/LocalState$/.test(t.name.value)),
  ];
  const sentences = ordered
    .map((t) =>
      describeType(
        isState(t) ? modelName : sentenceCase(words(t.name.value).join(" ")),
        t,
        enums,
      ),
    )
    .filter((s): s is string => s !== null);

  return { name: modelName, sentences, verbs, schema };
}
