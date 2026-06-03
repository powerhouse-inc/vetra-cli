import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveSpecBasePath } from "../../helpers/project.js";
import { formatColumns } from "./_helpers.js";
import { getSpecDocuments } from "./registry.js";

export const specList = defineCommand({
  id: "spec-list",
  description:
    "List spec documents. Filter with --category or --type. On a workdir that isn't a reactor package, lists the workspace-level product specs.",
  inputSchema: z.object({
    project: projectInputSchema,
    category: z
      .enum(["product", "project"])
      .optional()
      .describe(
        'Limit to one spec family: "product" (ideation sheets, feature, work-breakdown-structure) or "project" (builder set: document-model, editor, app, processor, subgraph). Omit to list both.',
      ),
    type: z
      .string()
      .optional()
      .describe(
        'Filter to one document type, e.g. "powerhouse/document-editor". Takes precedence over --category. Omit to list all specs.',
      ),
  }),
  execute: async (input, { workdir }) => {
    // Project specs only exist inside a reactor project; product specs may sit
    // at the workspace root.
    const { base, productFallback } = await resolveSpecBasePath(
      workdir,
      input.project,
      input.category !== "project",
    );
    const docs = await getSpecDocuments(base, {
      documentType: input.type,
      category: productFallback ? "product" : input.category,
    });
    if (docs.length === 0) {
      return { text: "(no specs)" };
    }
    const rows = docs.map((d) => [
      d.header.name,
      d.header.slug || "—",
      d.header.documentType,
      d.header.id,
    ]);
    return {
      text: formatColumns(rows),
    };
  },
});
