import {
  extractAllDocuments,
  extractAppDocuments,
  extractDocumentModelDocuments,
  extractEditorDocuments,
  extractProcessorDocuments,
  extractSubgraphDocuments,
  saveSpec,
} from "@powerhousedao/vetra/codegen";
import { buildTsMorphProject } from "@powerhousedao/codegen/utils";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { applyFsChangesToReactor } from "../../helpers/spec-drive-sync.js";
import { slugify } from "./_helpers.js";

const typeSchema = z
  .enum(["all", "document-model", "editor", "app", "processor", "subgraph"])
  .default("all")
  .describe(
    'Which modules to extract. "all" (default) covers every type; or pick one.',
  );

export const specExtract = defineCommand({
  id: "spec-extract",
  description: "Extract specs by reverse-engineering existing package source.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: typeSchema,
  }),
  execute: async (input, context) => {
    const { workdir } = context;
    const base = await resolveReactorProjectPath(workdir, input.project);
    /* `@powerhousedao/codegen` and `@powerhousedao/vetra` resolve to two
     * physical copies of `ts-morph` (same version, different install paths), so
     * TS treats their `Project` types as distinct. Cast bridges the structural
     * gap; identical at runtime. Held in a `let` so the full-project AST can be
     * dropped once extraction is done. */
    let tsProject: ReturnType<typeof buildTsMorphProject> | null =
      buildTsMorphProject(base);
    const docs: PHDocument[] = (() => {
      switch (input.type) {
        case "document-model":
          return extractDocumentModelDocuments(tsProject);
        case "editor":
          return extractEditorDocuments(tsProject);
        case "app":
          return extractAppDocuments(tsProject);
        case "processor":
          return extractProcessorDocuments(tsProject);
        case "subgraph":
          return extractSubgraphDocuments(tsProject);
        case "all": {
          const all = extractAllDocuments(tsProject);
          return [
            ...all.documentModels,
            ...all.editors,
            ...all.apps,
            ...all.processors,
            ...all.subgraphs,
          ];
        }
      }
    })();
    // Drop the AST; the rest of the command only touches extracted docs.
    tsProject = null;

    const written: string[] = [];
    for (const doc of docs) {
      /* The extract* helpers only seed `header.name`; populate slug here so
       * extracted docs match the invariant established by `spec-create`. */
      if (!doc.header.slug && doc.header.name) {
        doc.header.slug = slugify(doc.header.name);
      }
      written.push(await saveSpec(doc, base));
    }

    // Push extracted specs into the embedded drive when a reactor is running.
    const drive = await getEmbeddedDrive(context);
    if (drive && written.length > 0) {
      await applyFsChangesToReactor(
        written,
        workdir,
        drive.reactor,
        drive.driveId,
        context.log,
      );
    }

    return {
      text:
        written.length === 0
          ? "(no specs extracted)"
          : `Wrote ${written.length} spec(s):\n${written.join("\n")}`,
    };
  },
});
