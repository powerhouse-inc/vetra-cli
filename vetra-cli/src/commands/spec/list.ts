import { join } from "node:path";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  pathExists,
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
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
    // Product specs are workspace-level ideation artifacts that exist before any
    // reactor project. When the workdir isn't itself a reactor package and the
    // caller neither named a project nor asked specifically for project specs,
    // list the product specs sitting at the workspace root instead of erroring.
    const productFallback =
      !input.project &&
      input.category !== "project" &&
      !(await pathExists(join(workdir, "powerhouse.config.json")));

    const base = productFallback
      ? workdir
      : await resolveReactorProjectPath(workdir, input.project);
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
