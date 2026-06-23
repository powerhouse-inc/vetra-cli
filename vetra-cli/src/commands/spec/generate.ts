import type { PHDocument } from "@powerhousedao/shared/document-model";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import {
  runChecks,
  summarizeDiagnostics,
  type GenDiagnostic,
} from "../../helpers/project-checks.js";
import { DOCUMENT_MODEL_TYPE } from "./document-model.js";
import { withProjectCodegenLock } from "../../helpers/project-lock.js";
import { phBuildNodeOptions } from "../../helpers/node-memory.js";
import { findByName, getDocumentsWithPaths } from "./_helpers.js";

// documentType → `ph generate <subcommand>`. The five builder types each map to
// a subcommand; domain (vetra-app product) spec types have no codegen path.
const GENERATE_SUBCOMMAND: Record<string, string> = {
  [DOCUMENT_MODEL_TYPE]: "document-model",
  "powerhouse/document-editor": "editor",
  "powerhouse/app": "app",
  "powerhouse/processor": "processor",
  "powerhouse/subgraph": "subgraph",
};

type RunProcess = (
  command: string,
  opts?: {
    label?: string;
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  },
) => Promise<{ success: boolean; output: string }>;

// `@graphql-tools/load` inlines the failing SDL into the subprocess output;
// these patterns pull the real GraphQLError back out of the wall of types.
const DIAGNOSTIC_PATTERNS = [
  /Failed to parse the GraphQL document\.[^\n]*/,
  /Cannot use [A-Za-z]+ "[^"]+" from another module or realm\.?/,
  /Unknown type[:]? "?[^"\n]+"?/,
  /Unknown directive "?[^"\n]+"?/,
  /Type "[^"]+" not found/,
];

function trimGenerateError(message: string): string {
  for (const pattern of DIAGNOSTIC_PATTERNS) {
    const m = message.match(pattern);
    if (m) return m[0];
  }
  if (/Failed to load schema from/.test(message)) {
    return (
      "GraphQL schema failed to load (check operation/state SDL for " +
      "undeclared types/scalars). Run with debug logging for the full error."
    );
  }
  return message;
}

// Run `ph generate <subcommand> --document <specFilePath>` in the reactor
// project. The subprocess owns codegen; vetra-cli no longer generates in-process.
async function generateOne(
  doc: PHDocument,
  specFilePath: string,
  base: string,
  runProcess: RunProcess,
): Promise<void> {
  const subcommand = GENERATE_SUBCOMMAND[doc.header.documentType];
  if (!subcommand) {
    throw new Error(
      `Unsupported document type for code generation: ${doc.header.documentType}`,
    );
  }
  const command = `ph generate ${subcommand} --document "${specFilePath}"`;
  const { success, output } = await runProcess(command, {
    label: "ph-generate",
    timeout: 120_000,
    cwd: base,
    env: { FORCE_COLOR: "1", NODE_OPTIONS: phBuildNodeOptions() },
  });
  if (!success) {
    throw new Error(output);
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
    // codegen rewrites shared barrels/manifest from the project's view, so
    // concurrent runs clobber each other; serialize per reactor project.
    return withProjectCodegenLock(base, async () => {
      // Each target carries the doc plus its on-disk spec file, passed to
      // `ph generate --document`.
      // Real on-disk path only (never a recomputed specPath): the saved filename
      // uses a different kebab than specPath derives, so a recompute can miss.
      const targets: { doc: PHDocument; path: string }[] = input.name
        ? [await findByName(base, input.name)]
        : await getDocumentsWithPaths(base);

      if (targets.length === 0) {
        return { text: "(no specs to generate)" };
      }

      const generated: { name: string; type: string }[] = [];
      const skipped: { name: string; type: string; reason: string }[] = [];

      for (const { doc, path } of targets) {
        const type = doc.header.documentType;
        if (!GENERATE_SUBCOMMAND[type]) {
          if (input.name) {
            throw new Error(
              `${type} — ${doc.header.name}: (no codegen for ${type})`,
            );
          }
          skipped.push({
            name: doc.header.name,
            type,
            reason: `(no codegen for ${type})`,
          });
          continue;
        }
        try {
          await generateOne(doc, path, base, runProcess);
          generated.push({ name: doc.header.name, type });
        } catch (err) {
          const reason = trimGenerateError(
            err instanceof Error ? err.message : String(err),
          );
          if (input.name) {
            throw new Error(`${type} — ${doc.header.name}: ${reason}`);
          }
          skipped.push({ name: doc.header.name, type, reason });
        }
      }

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
    });
  },
});
