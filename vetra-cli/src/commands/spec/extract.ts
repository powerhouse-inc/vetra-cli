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

type Project = Parameters<typeof extractAllDocuments>[0];

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
    type: typeSchema,
  }),
  execute: async (input, { workdir }) => {
    /* `@powerhousedao/codegen` and `@powerhousedao/vetra` resolve to two
     * physical copies of `ts-morph` (same version, different install paths), so
     * TS treats their `Project` types as distinct. Cast bridges the structural
     * gap; identical at runtime. */
    const project = buildTsMorphProject(workdir) as unknown as Project;
    const docs: PHDocument[] = (() => {
      switch (input.type) {
        case "document-model":
          return extractDocumentModelDocuments(project);
        case "editor":
          return extractEditorDocuments(project);
        case "app":
          return extractAppDocuments(project);
        case "processor":
          return extractProcessorDocuments(project);
        case "subgraph":
          return extractSubgraphDocuments(project);
        case "all": {
          const all = extractAllDocuments(project);
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

    const written: string[] = [];
    for (const doc of docs) {
      written.push(await saveSpec(doc, workdir));
    }

    return {
      text:
        written.length === 0
          ? "(no specs extracted)"
          : `Wrote ${written.length} spec(s):\n${written.join("\n")}`,
      data: {
        count: written.length,
        paths: written,
      },
    };
  },
});
