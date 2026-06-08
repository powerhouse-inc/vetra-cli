import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  createPreviewDrive,
  findPreviewDriveByPreferredEditor,
  resolveAppEditorId,
  resolvePreviewEndpoint,
} from "../../helpers/reactor-project-preview.js";

export const specPreviewCreateDrive = defineCommand({
  id: "spec-preview-create-drive",
  description:
    "Create a preview drive bound to a drive app. The drive's preferredEditor is set to the app's editor config.id so Connect renders the app when the drive is opened. Idempotent: reuses an existing preview drive already bound to this app.",
  inputSchema: z.object({
    project: projectInputSchema,
    app: z
      .string()
      .describe(
        "App spec display name or editor id. Used to resolve the preferredEditor value from powerhouse.manifest.json apps[].",
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for the preview drive. Defaults to "<App> Preview".',
      ),
  }),
  execute: async (input, context) => {
    const base = await resolveReactorProjectPath(
      context.workdir,
      input.project,
    );
    const { switchboardUrl } = resolvePreviewEndpoint(
      context.services,
      base,
      input.project ?? ".",
    );
    const appEditorId = resolveAppEditorId(base, input.app);
    const driveName = input.name ?? `${input.app} Preview`;

    // Reuse by app (preferredEditor), not by name, so a different --name/--app
    // spelling doesn't spawn a duplicate drive for the same app.
    const existing = await findPreviewDriveByPreferredEditor(
      switchboardUrl,
      appEditorId,
    );
    if (existing) {
      return {
        text: `Preview drive "${existing.name}" already exists  id: ${existing.id}  preferredEditor: ${existing.preferredEditor ?? "(none)"}`,
        data: {
          projectPath: base,
          driveId: existing.id,
          preferredEditor: existing.preferredEditor,
        },
      };
    }

    const drive = await createPreviewDrive(
      switchboardUrl,
      driveName,
      appEditorId,
    );
    return {
      text: `Created preview drive "${drive.name}"  id: ${drive.id}  preferredEditor: ${drive.preferredEditor ?? "(none)"}`,
      data: {
        projectPath: base,
        driveId: drive.id,
        preferredEditor: drive.preferredEditor,
      },
    };
  },
});
