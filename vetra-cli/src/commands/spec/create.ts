import { createDocument, saveSpec } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { assertKnownDocumentType, slugify } from "./_helpers.js";

export const specCreate = defineCommand({
  id: "spec-create",
  description: "Create a new spec document under specs/.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: z
      .string()
      .default("")
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
    const base = await resolveReactorProjectPath(workdir, input.project);
    requireOption(input.type, "type", "Run `spec-schema-list` to see valid types.");
    assertKnownDocumentType(input.type);
    const doc = createDocument(input.type, { name: input.name });
    /* `createDocument` only seeds `name`; populate slug from it so the doc
     * has a stable short handle alongside its display name and id. */
    doc.header.slug = slugify(input.name);
    if (input.dryRun) {
      return {
        text: `Created ${doc.header.documentType} "${doc.header.name}" (in-memory, not saved).`,
      };
    }
    const path = await saveSpec(doc, base);
    return {
      text: `Created ${doc.header.documentType} "${doc.header.name}"  id: ${doc.header.id}\n${path}`,
    };
  },
});
