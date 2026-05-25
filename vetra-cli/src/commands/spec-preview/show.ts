import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  findPreviewByName,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";

export const specPreviewShow = defineCommand({
  id: "spec-preview-show",
  description:
    "Resolve the preview iframe URL for a document in the reactor-project's preview drive. Use this to point the user's BUILD-card iframe at a specific document — the URL embeds the project's running Connect, the preview drive id, and the document slug, plus `?embed=1` so Connect renders without its outer chrome.",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to show — accepts display name, slug, or id (see spec-preview-list).",
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(
      context.workdir,
      input.project,
    );
    const { switchboardUrl, connectUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    if (!connectUrl) {
      throw new Error(
        `Reactor project "${input.project ?? "."}" is running but its Connect endpoint has not been captured yet. Retry shortly.`,
      );
    }
    const row = await findPreviewByName(switchboardUrl, driveId, input.name);
    const docPathSegment = row.slug ?? row.id;
    const base_ = connectUrl.replace(/\/+$/, "");
    const previewUrl = `${base_}/d/${driveId}/${docPathSegment}?embed=1`;
    return {
      text: `Preview URL: ${previewUrl}`,
      data: {
        previewUrl,
        projectPath: base,
        driveId,
        documentId: row.id,
        documentSlug: row.slug,
        documentName: row.name,
      },
    };
  },
});
