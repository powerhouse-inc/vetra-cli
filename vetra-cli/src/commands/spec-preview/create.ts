import { createDocument } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  createPreviewDocument,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { assertKnownDocumentType, slugify } from "../spec/_helpers.js";

export const specPreviewCreate = defineCommand({
  id: "spec-preview-create",
  description:
    "Create a document in the running reactor-project's preview drive.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: z
      .string()
      .default("")
      .describe('Document model type, e.g. "powerhouse/document-editor".'),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name; a kebab-cased slug is populated alongside it.",
      ),
    dryRun: z
      .boolean()
      .default(false)
      .describe(
        "If set, build the document in-memory only — don't push it to the preview drive.",
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(context.workdir, input.project);
    requireOption(input.type, "type", "Run `spec-schema-list` to see valid types.");
    assertKnownDocumentType(input.type);
    const doc = createDocument(input.type, { name: input.name });
    /* `createDocument` only seeds `name`; populate slug from it so the doc
     * has a stable short handle alongside its display name and id. */
    doc.header.slug = slugify(input.name);
    if (input.dryRun) {
      return {
        text: `Built ${doc.header.documentType} "${doc.header.name}" (in-memory, not pushed to preview drive).`,
        data: { document: { header: doc.header, state: doc.state } },
      };
    }
    const { switchboardUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    const created = await createPreviewDocument(switchboardUrl, driveId, doc);
    return {
      text: `Created ${created.documentType} "${created.name}"  id: ${created.id}  (preview drive ${driveId})`,
      data: {
        driveId,
        document: {
          header: {
            id: created.id,
            slug: created.slug,
            name: created.name,
            documentType: created.documentType,
            preferredEditor: created.preferredEditor,
          },
          state: created.state,
        },
      },
    };
  },
});
