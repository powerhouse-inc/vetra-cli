import { getDocumentModelSchema } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { formatSchema, renderProjected } from "./_helpers.js";

const HELP_TEXT = [
  "Usage:",
  "  spec-schema --type <type>                       summary + help (this text)",
  "  spec-schema --type <type> --action <NAME>       GraphQL input for one operation (latest spec)",
  "  spec-schema --type <type> --state               GraphQL state schema (latest spec)",
  "  spec-schema --type <type> --filter <jsonpath>   custom slice",
  "",
  "Shortcuts (--action, --state) target the LATEST specification — the one the reducer edits.",
  "",
  "JSONPath cookbook (use [(@.length-1)] to reach the latest spec):",
  "  $.specifications[(@.length-1)].modules[*].operations[*].name",
  "    → all operation names in the latest spec",
  "  $.specifications[(@.length-1)].modules[*].operations[?(@.name=='SET_MODEL_NAME')].schema",
  "    → one operation's GraphQL input",
  "  $.specifications[(@.length-1)].state.global.schema",
  "    → global state GraphQL",
  "",
  "Tip: combine with --format toon to compact large results.",
].join("\n");

export const specSchema = defineCommand({
  id: "spec-schema",
  description:
    "Read a doc-model schema. Pass --action, --state, or --filter for data; otherwise returns summary + help.",
  inputSchema: z.object({
    type: z
      .string()
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

    const schema = getDocumentModelSchema(input.type);
    const latest = schema.specifications.at(-1);
    const summary = `Schema for ${input.type}: ${schema.specifications.length} spec(s), latest has ${latest?.modules.length ?? 0} module(s).`;

    const sliced = input.filter || input.action || input.state;
    if (!input.full && !sliced) {
      return { text: `${summary}\n\n${HELP_TEXT}` };
    }

    let filter = input.filter;
    if (input.action) {
      filter = `$.specifications[(@.length-1)].modules[*].operations[?(@.name=='${input.action}')].schema`;
    } else if (input.state) {
      filter = "$.specifications[(@.length-1)].state.global.schema";
    }

    return renderProjected(schema, filter, input.format, summary);
  },
});
