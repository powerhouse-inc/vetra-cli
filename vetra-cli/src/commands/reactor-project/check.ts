import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  runChecks,
  summarizeDiagnostics,
  type CheckScope,
} from "../../helpers/project-checks.js";
import { resolveReactorProjectPath } from "../../helpers/project.js";

const inputSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      "Project directory name (relative to workdir). Only needed when the workdir is not already a Reactor package project.",
    ),
  scope: z
    .enum(["all", "module"])
    .optional()
    .describe(
      "Which files to report on. 'all' (default) covers the whole project; 'module' covers the spec-authored trees (document-models/editors/apps/processors/subgraphs).",
    ),
  skipLint: z
    .boolean()
    .optional()
    .describe("Skip the eslint pass. Defaults to false."),
  skipTypecheck: z
    .boolean()
    .optional()
    .describe("Skip the tsc pass. Defaults to false."),
});

export const reactorProjectCheck = defineCommand({
  id: "reactor-project-check",
  description:
    "Run TypeScript and ESLint over a Reactor project and report any diagnostics. Useful after hand-editing generated code or to verify a project compiles cleanly.",
  inputSchema,
  execute: async (
    { name, scope, skipLint, skipTypecheck },
    { workdir, runProcess },
  ) => {
    const base = await resolveReactorProjectPath(workdir, name);
    const resolvedScope: CheckScope = scope ?? "all";

    const { diagnostics, notes } = await runChecks(base, runProcess, {
      scope: resolvedScope,
      skipLint,
      skipTypecheck,
    });
    const summary = summarizeDiagnostics(diagnostics);

    const header =
      diagnostics.length === 0
        ? `**Check passed** — no diagnostics in ${resolvedScope === "module" ? "module files" : "project"}.`
        : `**Check found ${summary.errors} error(s), ${summary.warnings} warning(s)** (tsc: ${summary.tsc}, eslint: ${summary.eslint}).`;

    const lines = [header];
    for (const d of diagnostics.slice(0, 50)) {
      lines.push(
        `  ${d.severity === "error" ? "✗" : "!"} [${d.source}] ${d.file}:${d.line}:${d.column} ${d.code} — ${d.message}`,
      );
    }
    if (diagnostics.length > 50) {
      lines.push(`  … ${diagnostics.length - 50} more`);
    }
    for (const note of notes) {
      lines.push(`  · ${note}`);
    }

    return {
      text: lines.join("\n"),
    };
  },
});
