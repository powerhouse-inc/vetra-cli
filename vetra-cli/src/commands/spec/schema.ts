import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  assertKnownDocumentType,
  formatSchema,
  renderProjected,
} from "./_helpers.js";
import { getSpecSchema, listSpecTypes } from "./registry.js";

/* `--action` and `--state` always read from `specifications.at(-1)` (the
 * version the reducer is currently against). `--filter` is applied to the
 * whole schema, so JSONPath callers reach the latest spec with
 * `[(@.length-1)]`. */
function buildNextSteps(
  type: string,
  sample: { moduleName: string; actionName: string },
): string {
  return [
    "Next:",
    `  spec-schema --type ${type} --action <NAME>     GraphQL input for one action (latest spec)`,
    `  spec-schema --type ${type} --state             state GraphQL (latest spec)`,
    `  spec-schema --type ${type} --filter <jsonpath> arbitrary JSONPath against the full schema`,
    `  spec-schema --type ${type} --full              full schema (token-heavy; pair with --format toon)`,
    "",
    "JSONPath examples (use [(@.length-1)] to reach the latest spec):",
    "  All action names in the latest spec:",
    "    --filter '$.specifications[(@.length-1)].modules[*].operations[*].name'",
    `  Actions belonging to one module (e.g. "${sample.moduleName}"):`,
    `    --filter '$.specifications[(@.length-1)].modules[?(@.name=="${sample.moduleName}")].operations[*].name'`,
    `  One action's GraphQL input (same as --action ${sample.actionName}):`,
    `    --filter '$.specifications[(@.length-1)].modules[*].operations[?(@.name=="${sample.actionName}")].schema'`,
  ].join("\n");
}

/* Enums are declared in the state schemas; action inputs reference them by
 * name. Without their values the agent probed with placeholders ("X") and
 * read the list off the validation error (M0 staging run: 18–33 calls). */
const ENUM_DECL = /\benum\s+(\w+)\s*\{([^}]*)\}/g;

export function enumValues(latest: LatestSpec | undefined): Map<string, string[]> {
  // Drop descriptions ("""…""" and "…"), # comments and directives first:
  // their words are not values, and a "}" in one would end the enum early.
  const sdl = [latest?.state?.global?.schema, latest?.state?.local?.schema]
    .join("\n")
    .replace(/"""[^]*?"""/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/@\w+(?:\([^)]*\))?/g, " ");
  const enums = new Map<string, string[]>();
  for (const [, name, body] of sdl.matchAll(ENUM_DECL)) {
    enums.set(name, body.split(/[\s,]+/).filter((v) => /^\w+$/.test(v)));
  }
  return enums;
}

/** "Enum values" lines for every state enum `schema` (an action's input SDL) references. */
function referencedEnums(schema: string, latest: LatestSpec | undefined): string {
  const lines = [...enumValues(latest)]
    .filter(([name]) => new RegExp(`\\b${name}\\b`).test(schema))
    .map(([name, values]) => `  ${name}: ${values.join(" | ")}`);
  return lines.length ? `\n\nEnum values:\n${lines.join("\n")}` : "";
}

type LatestSpec = {
  version?: number;
  state?: { global?: { schema?: string | null }; local?: { schema?: string | null } };
  modules?: ReadonlyArray<{
    name?: string | null;
    operations?: ReadonlyArray<{ name?: string | null; schema?: string | null }>;
  }>;
};

function latestOf(type: string): LatestSpec | undefined {
  return (getSpecSchema(type).specifications as LatestSpec[]).at(-1);
}

function actionNames(latest: LatestSpec | undefined): string[] {
  return (latest?.modules ?? []).flatMap((m) =>
    (m.operations ?? [])
      .map((o) => o.name)
      .filter((n): n is string => typeof n === "string"),
  );
}

/** The `--action` value as names: one, or several comma-separated. */
export function splitActions(action: string | undefined): string[] {
  return (action ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Every spec type whose latest spec defines all of `actions`, with their inputs. */
function actionOwners(
  actions: readonly string[],
): { type: string; inputs: string[] }[] {
  return listSpecTypes().flatMap((type) => {
    const ops = (latestOf(type)?.modules ?? []).flatMap((m) => m.operations ?? []);
    const inputs: string[] = [];
    for (const action of actions) {
      const op = ops.find((o) => o.name === action);
      if (!op) return [];
      inputs.push(compactSdl(op.schema ?? ""));
    }
    return [{ type, inputs }];
  });
}

/**
 * `--action` without `--type` (staging: the agent left it out and re-ran the
 * call). One type has the action(s), or all that do take the same inputs →
 * that type. Types disagree (the editor's ADD_DOCUMENT_TYPE takes an id, the
 * app's doesn't) → every variant with its types, so one call still answers.
 * No type has them → null.
 */
export function resolveActionType(
  actions: readonly string[],
): { type: string } | { variants: string } | null {
  const owners = actionOwners(actions);
  if (owners.length === 0) return null;
  const key = (o: { inputs: string[] }) => JSON.stringify(o.inputs);
  if (owners.every((o) => key(o) === key(owners[0]))) {
    return { type: owners[0].type };
  }
  const groups = new Map<string, { types: string[]; inputs: string[] }>();
  for (const o of owners) {
    const group = groups.get(key(o)) ?? { types: [], inputs: o.inputs };
    group.types.push(o.type);
    groups.set(key(o), group);
  }
  const lines = [
    `${actions.join(", ")}: the input differs by type — pass --type for one.`,
  ];
  for (const { types, inputs } of groups.values()) {
    lines.push(`${types.join(", ")}:`);
    inputs.forEach((input, i) => lines.push(`  ${actions[i]}: ${input}`));
  }
  return { variants: lines.join("\n") };
}

/** An action's input SDL on one line, descriptions and comments dropped. */
function compactSdl(sdl: string): string {
  return sdl
    .replace(/"""[^]*?"""/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every action of `type` with its input shape, one per line, plus the state
 * enums they use — appended to `spec-create` so the agent has the shapes for
 * its `spec-update` calls without a `spec-schema` call per action.
 */
export function actionReference(type: string): string {
  const latest = latestOf(type);
  const lines: string[] = [];
  const all: string[] = [];
  for (const mod of latest?.modules ?? []) {
    for (const op of mod.operations ?? []) {
      if (!op.name) continue;
      const sdl = compactSdl(op.schema ?? "");
      all.push(sdl);
      lines.push(`  ${op.name}: ${sdl || "(no input)"}`);
    }
  }
  if (lines.length === 0) return "";
  return (
    `Actions of ${type} (spec-update input shapes — no spec-schema call needed):\n` +
    lines.join("\n") +
    referencedEnums(all.join("\n"), latest)
  );
}

function buildSummary(type: string, schema: { specifications: LatestSpec[] }) {
  const specs = schema.specifications;
  const latest = specs.at(-1);
  const version = latest?.version ?? specs.length;
  const moduleNames = (latest?.modules ?? [])
    .map((m) => m.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  const modules =
    moduleNames.length > 0 ? moduleNames.join(", ") : "(none)";
  return [
    `${type} — ${specs.length} specification(s), latest is v${version}.`,
    `Modules: ${modules}`,
  ].join("\n");
}

/* Pick the first module and its first action so the JSONPath examples are
 * grounded in the schema being inspected, rather than referencing a name from
 * a different doc-type. Falls back to generic placeholders for empty schemas. */
function pickSampleNames(latest: LatestSpec | undefined): {
  moduleName: string;
  actionName: string;
} {
  for (const mod of latest?.modules ?? []) {
    if (!mod.name) continue;
    for (const op of mod.operations ?? []) {
      if (op.name) return { moduleName: mod.name, actionName: op.name };
    }
    return { moduleName: mod.name, actionName: "ACTION_NAME" };
  }
  return { moduleName: "module-name", actionName: "ACTION_NAME" };
}

export const specSchema = defineCommand({
  id: "spec-schema",
  description:
    "Read a doc-model schema. Pass --action, --state, or --filter for data; otherwise returns summary + help.",
  inputSchema: z.object({
    type: z
      .string()
      .default("")
      .describe('Document model type, e.g. "powerhouse/document-editor".'),
    full: z
      .boolean()
      .default(false)
      .describe(
        "Return the full schema (token-heavy). Default returns a summary + help.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection. Mutually exclusive with --action / --state.",
      ),
    action: z
      .string()
      .optional()
      .describe(
        'Shortcut: return only the GraphQL input type for the named operation (e.g. "SET_MODEL_NAME"), followed by the values of every enum it uses. Several comma-separated names ("ADD_MODULE,ADD_OPERATION") return them all in one call. Implies --type when only one type has the action(s). Mutually exclusive with --filter / --state.',
      ),
    state: z
      .boolean()
      .default(false)
      .describe(
        "Shortcut: return only the GraphQL schema for the doc's global state. Mutually exclusive with --filter / --action.",
      ),
    format: formatSchema.optional(),
  }),
  execute: async (input) => {
    const shortcuts = [
      input.filter ? "--filter" : null,
      input.action ? "--action" : null,
      input.state ? "--state" : null,
    ].filter(Boolean);
    if (shortcuts.length > 1) {
      throw new Error(
        `Pass at most one of ${shortcuts.join(", ")} (mutually exclusive).`,
      );
    }

    const actions = splitActions(input.action);
    let type = input.type;
    if (!type && actions.length > 0) {
      const resolved = resolveActionType(actions);
      if (resolved && "variants" in resolved) return { text: resolved.variants };
      type = resolved?.type ?? "";
    }
    requireOption(type, "type", `Valid types: ${listSpecTypes().join(", ")}`);
    assertKnownDocumentType(type);
    const schema = getSpecSchema(type);
    const latest = schema.specifications.at(-1);
    const summary = buildSummary(type, schema);

    const sliced = input.filter || input.action || input.state;
    if (!input.full && !sliced) {
      const sample = pickSampleNames(latest);
      return {
        text: `${summary}\n\n${buildNextSteps(type, sample)}`,
      };
    }

    let filter = input.filter;
    if (actions.length > 0) {
      const validNames = actionNames(latest);
      const unknown = actions.find((a) => !validNames.includes(a));
      if (unknown) {
        /* Schemas can have dozens of actions; dumping them all drowns out the
         * "Did you mean" line. Above the inline cap, point at the discovery
         * command instead. */
        throw unknownValueError({
          subject: "action",
          value: unknown,
          context: `for ${type}`,
          candidates: validNames,
          knownLabel: "Valid action types",
          inlineLimit: 12,
          overflowHint: `Run \`spec-schema --type ${type}\` to explore the schema.`,
        });
      }
      const match = actions.map((a) => `@.name=='${a}'`).join(" || ");
      filter = `$.specifications[(@.length-1)].modules[*].operations[?(${match})].schema`;
    } else if (input.state) {
      filter = "$.specifications[(@.length-1)].state.global.schema";
    }

    const text = renderProjected(schema, filter, input.format);
    // Plain output only: appended lines would break a `--format` payload.
    if (input.action && !input.format) {
      return { text: text.trimEnd() + referencedEnums(text, latest) };
    }
    return { text };
  },
});
