import { z } from "zod";
import { REACTOR_PROJECT_CONNECT_PROXY_PATH } from "../../constants.js";
import { defineCommand } from "../../framework.js";
import {
  projectInputSchema,
  resolveReactorProjectPath,
} from "../../helpers/project.js";
import { runChecks } from "../../helpers/project-checks.js";
import {
  buildPreviewDocPath,
  buildPreviewDriveRootPath,
  driveRemoteUrl,
  findPreviewByName,
  getPreviewAuthToken,
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

    // Gate: the app/editor code must type-check AND be `any`-free before we
    // surface a preview. A non-compiling editor.tsx renders "Something went
    // wrong"; worse, an `as any` cast can silence a real type error and ship a
    // compiling-but-broken app (e.g. reading doc state off a nonexistent field
    // → an empty board). So we block on tsc errors plus the type-safety lint
    // rules that flag `any` escapes — but NOT on advisory formatting/style lint
    // (prettier, unused-vars), which shouldn't gate a preview. Scope "module"
    // covers the hand-written editors/ + apps/ trees (helpers/project-checks.ts).
    const { diagnostics, notes } = await runChecks(base, context.runProcess, {
      scope: "module",
    });
    // Fail closed: if the checks couldn't actually run (e.g. tsc/eslint missing
    // from the project's node_modules), `diagnostics` would be empty and the
    // gate would silently pass a possibly-broken app. Block and surface why.
    const skipped = notes.filter((n) => /skip/i.test(n));
    if (skipped.length > 0) {
      return {
        text:
          `Preview blocked — the safety checks could not run, so the app's ` +
          `correctness can't be verified:\n  ${skipped.join("\n  ")}\n` +
          `Resolve this (ensure the project's dependencies are installed) and ` +
          `re-run ${"`spec-preview-show`"}.`,
        data: {
          projectPath: base,
          blocked: true as const,
          errorCount: 0,
        },
      };
    }
    const UNSAFE_ANY_RULE =
      /no-unsafe|no-explicit-any|no-unnecessary-type-assertion/;
    const blocking = diagnostics.filter(
      (d) =>
        d.severity === "error" &&
        (d.source === "tsc" || UNSAFE_ANY_RULE.test(d.code)),
    );
    if (blocking.length > 0) {
      const head = blocking
        .slice(0, 15)
        .map(
          (d) =>
            `  ✗ [${d.source}] ${d.file}:${d.line}:${d.column} ${d.code} — ${d.message}`,
        )
        .join("\n");
      return {
        text:
          `Preview blocked — the project has ${blocking.length} type/safety error(s). ` +
          `These would render "Something went wrong" or a broken/empty view in the BUILD pane. ` +
          `Fix them with the real typed hooks — **do NOT use \`any\` / \`as any\` to silence them** — then re-run ${"`spec-preview-show`"}:\n` +
          `${head}${blocking.length > 15 ? `\n  … ${blocking.length - 15} more` : ""}`,
        data: {
          projectPath: base,
          blocked: true as const,
          errorCount: blocking.length,
        },
      };
    }

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

    const token = await getPreviewAuthToken(context.workdir, context.config);

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
          token,
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
    const row = await findPreviewByName(switchboardUrl, driveId, input.name, token);
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
