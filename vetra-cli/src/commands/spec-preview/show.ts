import { z } from "zod";
import { REACTOR_PROJECT_CONNECT_PROXY_PATH } from "../../constants.js";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  buildPreviewDocPath,
  buildPreviewDriveRootPath,
  driveRemoteUrl,
  findPreviewByName,
  resolveAppEditorId,
  resolvePreviewEndpoint,
  setDrivePreferredEditor,
} from "../../helpers/reactor-project-preview.js";

export const specPreviewShow = defineCommand({
  id: "spec-preview-show",
  description:
    "Resolve the preview iframe URL for a document or drive in the reactor-project. Use this to point the user's BUILD-card iframe at a specific document or drive root. For documents, the URL embeds the preview drive id and document slug. For drives (use --drive), it points at the drive root so Connect renders the drive's app. Both include `?embed=1` so Connect renders without its outer chrome.",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z
      .string()
      .default("")
      .describe(
        "Preview document to show — accepts display name, slug, or id (see spec-preview-list). Ignored when --drive is set.",
      ),
    drive: z
      .string()
      .optional()
      .describe(
        "Drive id to show. When set, resolves a drive-root URL (renders the drive's app) instead of a document URL.",
      ),
    app: z
      .string()
      .optional()
      .describe(
        "App spec display name or editor id (only with --drive). Re-binds the drive's preferredEditor before showing — REQUIRED after populating the drive, because adding documents wipes the binding. Resolved from powerhouse.manifest.json apps[].",
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(
      context.workdir,
      input.project,
    );
    const { switchboardUrl, connectUrl, driveId: defaultDriveId } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    if (!connectUrl) {
      throw new Error(
        `Reactor project "${input.project ?? "."}" is running but its Connect endpoint has not been captured yet. Retry shortly.`,
      );
    }

    if (input.drive) {
      // Re-assert the app binding AFTER populate: adding documents to a drive
      // wipes its header.meta.preferredEditor, so set it again here (this is the
      // last step before the user views the preview).
      let preferredEditor: string | null = null;
      if (input.app) {
        const editorId = resolveAppEditorId(base, input.app);
        preferredEditor = await setDrivePreferredEditor(
          switchboardUrl,
          input.drive,
          editorId,
        );
      }
      // Append the drive's remote URL so Connect registers it via addRemoteDrive
      // on load (an ad-hoc app drive isn't in Connect's known set otherwise).
      const docPath = buildPreviewDriveRootPath(
        input.drive,
        driveRemoteUrl(switchboardUrl, input.drive),
      );
      const previewUrl = context.proxy
        ? `${context.proxy.url}${REACTOR_PROJECT_CONNECT_PROXY_PATH}${docPath}`
        : `${connectUrl.replace(/\/+$/, "")}${docPath}`;
      return {
        text:
          `Preview URL (drive): ${previewUrl}` +
          (input.app ? `  (preferredEditor: ${preferredEditor ?? "(none)"})` : ""),
        data: {
          projectPath: base,
          driveId: input.drive,
          kind: "drive" as const,
          documentId: null,
          documentSlug: null,
          preferredEditor,
          previewUrl,
        },
      };
    }

    const driveId = defaultDriveId;
    const row = await findPreviewByName(switchboardUrl, driveId, input.name);
    const docPath = buildPreviewDocPath(driveId, row.slug ?? row.id);
    const previewUrl = context.proxy
      ? `${context.proxy.url}${REACTOR_PROJECT_CONNECT_PROXY_PATH}${docPath}`
      : `${connectUrl.replace(/\/+$/, "")}${docPath}`;
    return {
      text: `Preview URL: ${previewUrl}`,
      data: {
        projectPath: base,
        driveId,
        kind: "document" as const,
        documentId: row.id,
        documentSlug: row.slug ?? null,
        previewUrl,
      },
    };
  },
});
