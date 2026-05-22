import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { formatSchema, loadByName, renderProjected } from "./_helpers.js";

/* Narrow a doc's state down to its latest specification entry. Only doc-model
 * specs have a versioned `specifications` array on state.global; for other doc
 * types, fall back to state.global so --latest is a no-op rather than a crash. */
function pickLatestSpec(state: unknown, documentType: string): unknown {
  if (documentType !== "powerhouse/document-model") {
    return (state as { global?: unknown }).global ?? state;
  }
  const global = (state as { global?: { specifications?: unknown[] } }).global;
  const specs = global?.specifications;
  if (Array.isArray(specs) && specs.length > 0) return specs[specs.length - 1];
  return global ?? state;
}

const HELP_BY_TYPE: Record<string, string> = {
  "powerhouse/document-model": [
    "  --filter $.global.name                                    model name",
    "  --latest --filter $.modules[*].name                       module names in the latest spec",
    "  --latest --filter \"$.modules[*].operations[?(@.name=='SET_MODEL_NAME')]\"  one operation",
  ].join("\n"),
  "powerhouse/document-editor": [
    "  --filter $.global                                         entire editor config",
    "  --filter $.global.documentTypes                           which doc types this editor handles",
  ].join("\n"),
  "powerhouse/processor": [
    "  --filter $.global                                         entire processor config",
    "  --filter $.global.subscribedDocumentTypes                 documents this processor listens to",
  ].join("\n"),
  "powerhouse/subgraph": [
    "  --filter $.global                                         entire subgraph config",
    "  --filter $.global.schema                                  GraphQL schema",
  ].join("\n"),
};

function buildHelp(documentType: string, name: string): string {
  const typed = HELP_BY_TYPE[documentType];
  const generic =
    "  --filter <jsonpath>                                       project against state (default scope: $.global)";
  const latestNote =
    documentType === "powerhouse/document-model"
      ? "\n  --latest scopes the value (and --filter) to state.global.specifications.at(-1).\n"
      : "\n";
  return [
    `Usage examples for "${name}" (${documentType}):`,
    generic,
    typed ?? "  --filter $.global                                         entire global state",
    latestNote + "Tip: combine with --format toon to compact large results.",
  ].join("\n");
}

export const specGet = defineCommand({
  id: "spec-get",
  description:
    "Read a spec. Pass --filter (or --latest) for data; otherwise returns summary + help.",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z
      .string()
      .default("")
      .describe(
        "Spec to read — accepts display name, slug, or id (see spec-list).",
      ),
    full: z
      .boolean()
      .default(false)
      .describe(
        "Return the full state value (token-heavy). Default returns a summary + help.",
      ),
    latest: z
      .boolean()
      .default(false)
      .describe(
        "For doc-model specs: scope the value (and --filter) to `state.global.specifications.at(-1)` instead of `state.global`. With --latest, the modules/state shortcuts become `$.modules[*]`, `$.state.global`, etc.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection. Without --latest, applied to the doc's state (default scope: $.global). With --latest, applied to the latest specification.",
      ),
    format: formatSchema.optional(),
  }),
  execute: async (input, { workdir }) => {
    const base = await resolveReactorProjectPath(workdir, input.project);
    const doc = await loadByName(base, input.name);
    const opsTotal = doc.operations.global.length + doc.operations.local.length;
    const summary = `${doc.header.documentType} "${doc.header.name}" — ${opsTotal} operation(s).`;

    if (!input.full && !input.filter && !input.latest) {
      return { text: `${summary}\n\n${buildHelp(doc.header.documentType, input.name)}` };
    }

    const value = input.latest
      ? pickLatestSpec(doc.state, doc.header.documentType)
      : doc.state;
    // Default filter scope: $.global (state.global), unless --full (whole state)
    // or --latest (already narrowed to the latest spec entry).
    const filter =
      input.filter ?? (input.latest || input.full ? "$" : "$.global");
    return renderProjected(value, filter, input.format, summary);
  },
});
