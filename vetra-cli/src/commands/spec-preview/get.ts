import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  findPreviewByName,
  getPreviewDocument,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { formatSchema, renderProjected } from "../spec/_helpers.js";

export const specPreviewGet = defineCommand({
  id: "spec-preview-get",
  description:
    "Read a document from the reactor-project's preview drive. Pass --filter for projection.",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to read — accepts display name, slug, or id (see spec-preview-list).",
      ),
    full: z
      .boolean()
      .default(false)
      .describe(
        "Return the full state value (token-heavy). Default returns a summary plus header info.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "JSONPath (RFC 9535) projection. Default scope: $.global (state.global). With --full, scope is the whole state.",
      ),
    format: formatSchema.optional(),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(context.workdir, input.project);
    const { switchboardUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    const row = await findPreviewByName(switchboardUrl, driveId, input.name);
    const doc = await getPreviewDocument(switchboardUrl, row.id);
    if (!doc) {
      throw new Error(
        `Preview document "${row.name}" (${row.id}) vanished between list and fetch.`,
      );
    }
    const opsTotal = doc.revisionsList.reduce((sum, r) => sum + r.revision, 0);
    const summary = `${doc.documentType} "${doc.name}" — ${opsTotal} operation(s).`;

    if (!input.full && !input.filter) {
      return { text: summary };
    }

    const filter = input.filter ?? (input.full ? "$" : "$.global");
    return { text: renderProjected(doc.state, filter, input.format) };
  },
});
