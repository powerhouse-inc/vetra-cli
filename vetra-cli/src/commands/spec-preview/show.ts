import { z } from "zod";
import { REACTOR_PROJECT_CONNECT_PROXY_PATH } from "../../constants.js";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import {
  buildPreviewDocPath,
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
    const docPath = buildPreviewDocPath(driveId, row.slug ?? row.id);
    // The URL is for the user's browser — prefer the proxy origin (the only
    // reachable one on deployed agents) over the direct Connect port.
    const previewUrl = context.proxy
      ? `${context.proxy.url}${REACTOR_PROJECT_CONNECT_PROXY_PATH}${docPath}`
      : `${connectUrl.replace(/\/+$/, "")}${docPath}`;
    /* The structured `data` field is the contract Vetra Studio's
     * `useSessionPreviewTarget` reads to drive the BUILD pane iframe
     * (see `vetra-app/editors/vetra-studio/hooks/useSessionPreviewTarget.ts`).
     * Returning only `text` was a silent failure — the agent saw success but
     * Connect never received enough to swap the iframe target. */
    return {
      text: `Preview URL: ${previewUrl}`,
      data: {
        projectPath: base,
        driveId,
        documentId: row.id,
        documentSlug: row.slug ?? null,
        previewUrl,
      },
    };
  },
});
