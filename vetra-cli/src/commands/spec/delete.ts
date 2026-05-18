import { deleteDocument } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { findByName } from "./_helpers.js";

export const specDelete = defineCommand({
  id: "spec-delete",
  description: "Delete a spec document by name.",
  inputSchema: z.object({
    name: z.string().describe("Spec document name."),
  }),
  execute: async (input, { workdir }) => {
    const { doc, path } = await findByName(workdir, input.name);
    const result = await deleteDocument(path);
    return {
      text: result.success
        ? `Deleted "${doc.header.name}" (${doc.header.id})`
        : `Failed to delete "${doc.header.name}" at ${path}`,
      data: { ...result, name: doc.header.name, id: doc.header.id, path },
    };
  },
});
