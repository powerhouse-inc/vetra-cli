import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  findPreviewByName,
  mutatePreviewDocument,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";
import {
  actionInputSchema,
  enrichActionValidationError,
  resolveActionsInput,
} from "../spec/_helpers.js";

export const specPreviewUpdate = defineCommand({
  id: "spec-preview-update",
  description:
    "Apply actions to a preview document through the document model's reducer.",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to update — accepts display name, slug, or id (see spec-preview-list).",
      ),
    drive: z
      .string()
      .optional()
      .describe(
        "Target drive id. When omitted, uses the project's default preview drive.",
      ),
    actions: z
      .preprocess((v) => {
        /* Tool/MCP callers pass a real array; shell users pass `--actions
         * '[...]'`, which arrives as a JSON-encoded string. Accept both. */
        if (typeof v !== "string") return v;
        try {
          return JSON.parse(v) as unknown;
        } catch {
          return v;
        }
      }, z.array(actionInputSchema))
      .optional()
      .describe(
        "Inline JSON array of actions. Preferred for agent tool calls — no filesystem detour needed.",
      ),
    from: z
      .string()
      .optional()
      .describe(
        "Path to a JSON file containing the actions array. Use for human CLI workflows.",
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(context.workdir, input.project);
    const { switchboardUrl, driveId: defaultDriveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    const driveId = input.drive ?? defaultDriveId;
    const row = await findPreviewByName(switchboardUrl, driveId, input.name);
    const actions = await resolveActionsInput({
      actions: input.actions,
      from: input.from,
    });
    let next: Awaited<ReturnType<typeof mutatePreviewDocument>>;
    try {
      next = await mutatePreviewDocument(switchboardUrl, row.id, actions);
    } catch (err) {
      enrichActionValidationError(err, row.documentType);
    }
    const opsCount = next.revisionsList.reduce(
      (sum, r) => sum + r.revision,
      0,
    );
    return {
      text: `Applied ${actions.length} action(s) to ${next.documentType} "${next.name}" (now ${opsCount} op(s) total) in preview drive ${driveId}`,
    };
  },
});
