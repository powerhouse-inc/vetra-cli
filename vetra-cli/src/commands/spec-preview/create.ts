import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { requireOption } from "../../helpers/cli-errors.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  createEmptyPreviewDocument,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";

export const specPreviewCreate = defineCommand({
  id: "spec-preview-create",
  description:
    "Create a document in the running reactor-project's preview drive. Any document type registered by the running reactor is accepted — framework spec types and document models from installed packages alike.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: z
      .string()
      .default("")
      .describe(
        'Type of a ocument model spec in the project, e.g. "brand/todo-list".',
      ),
    name: z
      .string()
      .describe(
        "Human-readable display name. Used as the doc's header.name; the reactor populates the slug.",
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(context.workdir, input.project);
    requireOption(
      input.type,
      "type",
      "Pass any document type the running reactor knows about.",
    );
    const { switchboardUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    const created = await createEmptyPreviewDocument(
      switchboardUrl,
      driveId,
      input.type,
      input.name,
    );
    return {
      text: `Created ${created.documentType} "${created.name}"  id: ${created.id}  (preview drive ${driveId})`,
    };
  },
});
