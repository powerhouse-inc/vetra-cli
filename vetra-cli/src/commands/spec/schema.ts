import { getDocumentModelSchema } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption, unknownValueError } from "../../helpers/cli-errors.js";
import {
  assertKnownDocumentType,
  formatSchema,
  renderProjected,
} from "./_helpers.js";

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

type LatestSpec = {
  version?: number;
  modules?: ReadonlyArray<{
    name?: string | null;
    operations?: ReadonlyArray<{ name?: string | null }>;
  }>;
};

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
        'Shortcut: return only the GraphQL input type for the named operation (e.g. "SET_MODEL_NAME"). Mutually exclusive with --filter / --state.',
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

    requireOption(input.type, "type", "Run `spec-schema-list` to see valid types.");
    assertKnownDocumentType(input.type);
    const schema = getDocumentModelSchema(input.type);
    const latest = schema.specifications.at(-1);
    const summary = buildSummary(input.type, schema);

    const sliced = input.filter || input.action || input.state;
    if (!input.full && !sliced) {
      const sample = pickSampleNames(latest);
      return {
        text: `${summary}\n\n${buildNextSteps(input.type, sample)}`,
      };
    }

    let filter = input.filter;
    if (input.action) {
      const validNames = (latest?.modules ?? []).flatMap((m) =>
        (m.operations ?? [])
          .map((o) => o.name)
          .filter((n): n is string => typeof n === "string"),
      );
      if (!validNames.includes(input.action)) {
        /* Schemas can have dozens of actions; dumping them all drowns out the
         * "Did you mean" line. Above the inline cap, point at the discovery
         * command instead. */
        throw unknownValueError({
          subject: "action",
          value: input.action,
          context: `for ${input.type}`,
          candidates: validNames,
          knownLabel: "Valid action types",
          inlineLimit: 12,
          overflowHint: `Run \`spec-schema --type ${input.type}\` to explore the schema.`,
        });
      }
      filter = `$.specifications[(@.length-1)].modules[*].operations[?(@.name=='${input.action}')].schema`;
    } else if (input.state) {
      filter = "$.specifications[(@.length-1)].state.global.schema";
    }

    return renderProjected(schema, filter, input.format, summary);
  },
});
