import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { applyFsChangesToReactor } from "../../helpers/spec-drive-sync.js";
import { assertKnownDocumentType, slugify } from "./_helpers.js";
import { createSpecDocument, isProductSpecType, saveSpec } from "./registry.js";

export const specCreate = defineCommand({
  id: "spec-create",
  description:
    "Create a new spec document under specs/. Product specs always go to the workspace root and need no reactor project; project specs require one.",
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
    requireOption(input.type, "type", "Run `spec-schema-list` to see valid types.");
    assertKnownDocumentType(input.type);
    // Product specs are workspace-level: always saved at the workdir root,
    // never inside a project. Project specs require a reactor project.
    let base: string;
    if (isProductSpecType(input.type)) {
      if (input.project) {
        throw new Error(
          `Product specs live at the workspace root — omit --project for ${input.type}.`,
        );
      }
      base = workdir;
    } else {
      base = await resolveReactorProjectPath(workdir, input.project);
    }
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
