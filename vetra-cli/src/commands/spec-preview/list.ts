import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  listPreviewDocuments,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import { formatColumns } from "../spec/_helpers.js";

export const specPreviewList = defineCommand({
  id: "spec-preview-list",
  description:
    "List documents in the running reactor-project's preview drive.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: z
      .string()
      .optional()
      .describe(
        'Filter to one document type, e.g. "powerhouse/document-editor". Omit to list every preview document.',
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(context.workdir, input.project);
    const { switchboardUrl, driveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    const items = await listPreviewDocuments(switchboardUrl, driveId);
    const filtered = input.type
      ? items.filter((d) => d.documentType === input.type)
      : items;
    if (filtered.length === 0) {
      return { text: "(no preview documents)", data: { driveId, documents: [] } };
    }
    const rows = filtered.map((d) => {
      const ops = d.revisionsList.reduce((sum, r) => sum + r.revision, 0);
      return [
        d.name,
        d.slug ?? "—",
        d.id,
        d.documentType,
        String(ops),
      ];
    });
    return {
      text: formatColumns(rows),
      data: {
        driveId,
        documents: filtered.map((d) => ({
          name: d.name,
          slug: d.slug,
          id: d.id,
          type: d.documentType,
          ops: d.revisionsList.reduce((sum, r) => sum + r.revision, 0),
        })),
      },
    };
  },
});
