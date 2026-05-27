import { deleteDocument } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { findByName } from "./_helpers.js";

export const specDelete = defineCommand({
  id: "spec-delete",
  description: "Delete a spec document by name.",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z
      .string()
      .default("")
      .describe(
        "Spec to delete — accepts display name, slug, or id (see spec-list).",
      ),
  }),
  execute: async (input, { workdir }) => {
    const base = await resolveReactorProjectPath(workdir, input.project);
    const { doc, path } = await findByName(base, input.name);
    const result = await deleteDocument(path);
    return {
      text: result.success
        ? `Deleted "${doc.header.name}" (${doc.header.id})`
        : `Failed to delete "${doc.header.name}" at ${path}`,
    };
  },
});
