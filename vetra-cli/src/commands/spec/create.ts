import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { applyFsChangesToReactor } from "../../helpers/spec-drive-sync.js";
import { assertKnownDocumentType, slugify } from "./_helpers.js";
import { createSpecDocument, saveSpec } from "./registry.js";

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
  execute: async (input, context) => {
    const { workdir } = context;
    const base = await resolveReactorProjectPath(workdir, input.project);
    requireOption(input.type, "type", "Run `spec-schema-list` to see valid types.");
    assertKnownDocumentType(input.type);
    const doc = createSpecDocument(input.type, { name: input.name });
    /* `createDocument` only seeds `name`; populate slug from it so the doc
     * has a stable short handle alongside its display name and id. */
    doc.header.slug = slugify(input.name);
    if (input.dryRun) {
      return {
        text: `Created ${doc.header.documentType} "${doc.header.name}" (in-memory, not saved).`,
      };
    }
    const path = await saveSpec(doc, base);
    // When a reactor is already running (daemon), push the new spec straight
    // into the embedded drive so Studio reflects it without the watcher.
    const drive = await getEmbeddedDrive(context);
    if (drive) {
      await applyFsChangesToReactor(
        [path],
        workdir,
        drive.reactor,
        drive.driveId,
        context.log,
      );
    }
    return {
      text: `Created ${doc.header.documentType} "${doc.header.name}"  id: ${doc.header.id}\n${path}`,
    };
  },
});
