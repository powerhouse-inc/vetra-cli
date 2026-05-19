import { createDocument, saveSpec } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";

export const specCreate = defineCommand({
  id: "spec-create",
  description: "Create a new spec document under specs/.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: z
      .string()
      .describe('Document model type, e.g. "powerhouse/document-editor".'),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name and (kebab-cased) as the filename.",
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "If set, create the doc in-memory only — don't persist to specs/.",
      ),
  }),
  execute: async (input, { workdir }) => {
    const base = resolveReactorProjectPath(workdir, input.project);
    const doc = createDocument(input.type, { name: input.name });
    if (input.dryRun) {
      return {
        text: `Created ${doc.header.documentType} "${doc.header.name}" (in-memory, not saved).`,
        data: { document: { header: doc.header, state: doc.state } },
      };
    }
    const path = await saveSpec(doc, base);
    return {
      text: `Created ${doc.header.documentType} "${doc.header.name}"  id: ${doc.header.id}\n${path}`,
      data: {
        path,
        document: { header: doc.header, state: doc.state },
      },
    };
  },
});
