import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  createEmptyPreviewDocument,
  getPreviewAuthToken,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";

export const specPreviewCreate = defineCommand({
  id: "spec-preview-create",
  description:
    "Create a document in the running reactor-project's preview drive. Any document type registered by the running reactor is accepted — framework spec types and document models from installed packages alike. Use --drive to target a specific drive (e.g. an app preview drive).",
  inputSchema: z.object({
    project: projectInputSchema,
    type: z
      .string()
      .default("")
      .describe(
        'Type of a document model spec in the project, e.g. "brand/todo-list".',
      ),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name; the reactor populates the slug.",
      ),
    drive: z
      .string()
      .optional()
      .describe(
        "Target drive id. When omitted, uses the project's default preview drive. Pass a drive id from spec-preview-create-drive to create documents inside an app preview drive.",
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(context.workdir, input.project);
    requireOption(
      input.type,
      "type",
      "Pass any document type the running reactor knows about.",
    );
    const { switchboardUrl, driveId: defaultDriveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    const driveId = input.drive ?? defaultDriveId;
    const token = await getPreviewAuthToken(context.workdir, context.config);
    const created = await createEmptyPreviewDocument(
      switchboardUrl,
      driveId,
      input.type,
      input.name,
      token,
    );
    return {
      text: `Created ${created.documentType} "${created.name}"  id: ${created.id}  (drive ${driveId})`,
    };
  },
});
