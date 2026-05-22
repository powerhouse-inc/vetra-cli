import { getDocuments } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { formatColumns } from "./_helpers.js";

export const specList = defineCommand({
  id: "spec-list",
  description: "List spec documents. Filter with --type.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: z
      .string()
      .optional()
      .describe(
        'Filter to one document type, e.g. "powerhouse/document-editor". Omit to list all specs.',
      ),
  }),
  execute: async (input, { workdir }) => {
    const base = await resolveReactorProjectPath(workdir, input.project);
    const docs = await getDocuments(base, { documentType: input.type });
    if (docs.length === 0) {
      return { text: "(no specs)", data: { documents: [] } };
    }
    const rows = docs.map((d) => [
      d.header.name,
      d.header.slug || "—",
      d.header.documentType,
      d.header.id,
    ]);
    return {
      text: formatColumns(rows),
      data: {
        documents: docs.map((d) => ({
          name: d.header.name,
          slug: d.header.slug,
          type: d.header.documentType,
          id: d.header.id,
        })),
      },
    };
  },
});
