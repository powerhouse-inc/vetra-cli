import type { generateDocumentModelFromDocument } from "@powerhousedao/vetra/codegen";
import type { PHDocument } from "@powerhousedao/shared/document-model";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import {
  runChecks,
  summarizeDiagnostics,
  type GenDiagnostic,
} from "../../helpers/project-checks.js";
import { loadByName } from "./_helpers.js";

type Project = Parameters<typeof generateDocumentModelFromDocument>[1];

// ts-morph + graphql-codegen + the TS compiler load here; kept lazy so boot
// doesn't pay for them — only spec-generate needs them.
async function loadCodegen() {
  return import("@powerhousedao/vetra/codegen");
}
async function loadTsMorph() {
  return import("@powerhousedao/codegen/utils");
}
type Codegen = Awaited<ReturnType<typeof loadCodegen>>;

const DOC_TYPES = {
  documentModel: "powerhouse/document-model",
  editor: "powerhouse/document-editor",
  app: "powerhouse/app",
  processor: "powerhouse/processor",
  subgraph: "powerhouse/subgraph",
} as const;

function trimGenerateError(message: string): string {
  /* `@graphql-tools/load` inlines the full schema into `err.message` several
   * times when codegen fails on the SDL. Pull out just the diagnostic line:
   * the library wraps every schema failure (syntax + validation) in a
   * "Failed to parse the GraphQL document. <GraphQLError>" line. */
  const parse = message.match(/Failed to parse the GraphQL document\.[^\n]*/);
  if (parse) {
    return parse[0];
  }
  /* `@graphql-tools/load` echoes the entire failing SDL into the message after
   * "Failed to load schema from", typically ending in `scalar Unknown`. Drop
   * the echoed SDL and surface where to look. */
  if (/Failed to load schema from/.test(message)) {
    return (
      "GraphQL schema failed to load (check operation/state SDL for " +
      "undeclared types/scalars)."
    );
  }
  const firstLine = message.split("\n").find((l) => l.trim().length > 0);
  return firstLine ?? message;
}

async function generateOne(
  doc: PHDocument,
  project: Project,
  codegen: Codegen,
): Promise<void> {
  switch (doc.header.documentType) {
    case DOC_TYPES.documentModel:
      return codegen.generateDocumentModelFromDocument(doc as never, project);
    case DOC_TYPES.editor:
      return codegen.generateEditorFromDocument(doc as never, project);
    case DOC_TYPES.app:
      return codegen.generateAppFromDocument(doc as never, project);
    case DOC_TYPES.processor:
      return codegen.generateProcessorFromDocument(doc as never, project);
    case DOC_TYPES.subgraph:
      return codegen.generateSubgraphFromDocument(doc as never, project);
    default:
      throw new Error(
        `Unsupported document type for code generation: ${doc.header.documentType}`,
      );
  }
}

export const specGenerate = defineCommand({
  id: "spec-generate",
  description:
    "Generate source code from one or all specs in the project (document models, editors, apps, processors, subgraphs).",
  inputSchema: z.object({
    project: projectInputSchema,
    name: z
      .string()
      .optional()
      .describe(
        "Spec to generate — accepts display name, slug, or id (see spec-list). When omitted, generate code for every spec under specs/.",
      ),
    skipChecks: z
      .boolean()
      .optional()
      .describe(
        "Skip the post-generation typecheck and lint over generated files. Defaults to false.",
      ),
  }),
  execute: async (input, { workdir, runProcess }) => {
    const base = await resolveReactorProjectPath(workdir, input.project);
    const [codegen, { buildTsMorphProject }] = await Promise.all([
      loadCodegen(),
      loadTsMorph(),
    ]);
    /* `@powerhousedao/codegen` and `@powerhousedao/vetra` resolve to two
     * physical copies of `ts-morph` (same version, different install paths), so
     * TS treats their `Project` types as distinct. Cast bridges the structural
     * gap; identical at runtime. */
    const tsProject = buildTsMorphProject(base);

    const docs = input.name
      ? [await loadByName(base, input.name)]
      : await codegen.getDocuments(base);

    if (docs.length === 0) {
      return { text: "(no specs to generate)" };
    }

    const generated: { name: string; type: string }[] = [];
    const skipped: { name: string; type: string; reason: string }[] = [];

    for (const doc of docs) {
      try {
        await generateOne(doc, tsProject, codegen);
        generated.push({
          name: doc.header.name,
          type: doc.header.documentType,
        });
      } catch (err) {
        const reason = trimGenerateError(
          err instanceof Error ? err.message : String(err),
        );
        if (input.name) {
          throw new Error(
            `${doc.header.documentType} — ${doc.header.name}: ${reason}`,
          );
        }
        skipped.push({
          name: doc.header.name,
          type: doc.header.documentType,
          reason,
        });
      }
    }

    await tsProject.save();

    let diagnostics: GenDiagnostic[] = [];
    const checkNotes: string[] = [];
    if (!input.skipChecks && generated.length > 0) {
      const outcome = await runChecks(base, runProcess, { scope: "module" });
      diagnostics = outcome.diagnostics;
      checkNotes.push(...outcome.notes);
    }
    const summary = summarizeDiagnostics(diagnostics);

    if (input.name && summary.errors > 0) {
      const head = diagnostics
        .filter((d) => d.severity === "error")
        .slice(0, 5)
        .map(
          (d) =>
            `[${d.source}] ${d.file}:${d.line}:${d.column} ${d.code} — ${d.message}`,
        )
        .join("\n  ");
      throw new Error(
        `Generated code has ${summary.errors} error(s) (tsc: ${summary.tsc}, eslint: ${summary.eslint}):\n  ${head}`,
      );
    }

    const lines = [
      `Generated ${generated.length} module(s)` +
        (skipped.length > 0 ? `, skipped ${skipped.length}` : "") +
        ".",
    ];
    for (const g of generated) {
      lines.push(`  ✓ ${g.type} — ${g.name}`);
    }
    for (const s of skipped) {
      lines.push(`  ✗ ${s.type} — ${s.name}: ${s.reason}`);
    }
    if (diagnostics.length > 0) {
      lines.push(
        `Generated-file checks: ${summary.errors} error(s), ${summary.warnings} warning(s) (tsc: ${summary.tsc}, eslint: ${summary.eslint}).`,
      );
      for (const d of diagnostics.slice(0, 20)) {
        lines.push(
          `  ${d.severity === "error" ? "✗" : "!"} [${d.source}] ${d.file}:${d.line}:${d.column} ${d.code} — ${d.message}`,
        );
      }
      if (diagnostics.length > 20) {
        lines.push(`  … ${diagnostics.length - 20} more`);
      }
    }
    for (const note of checkNotes) {
      lines.push(`  · ${note}`);
    }

    return {
      text: lines.join("\n"),
    };
  },
});
