import { deleteDocument } from "@powerhousedao/vetra/codegen";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveSpecBasePath } from "../../helpers/project.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { removeSpecFromDrive } from "../../helpers/spec-drive-sync.js";
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
  execute: async (input, context) => {
    const { workdir } = context;
    // Workspace-root product specs are reachable without a reactor project.
    const { base } = await resolveSpecBasePath(workdir, input.project, true);
    const { doc, path } = await findByName(base, input.name);
    const result = await deleteDocument(path);
    if (!result.success) {
      return { text: `Failed to delete "${doc.header.name}" at ${path}` };
    }
    // Mirror the FS removal into the embedded drive when a reactor is running.
    const drive = await getEmbeddedDrive(context);
    if (drive) {
      await removeSpecFromDrive(
        drive.reactor,
        drive.driveId,
        doc.header.id,
        context.log,
      );
    }
    return { text: `Deleted "${doc.header.name}" (${doc.header.id})` };
  },
});
