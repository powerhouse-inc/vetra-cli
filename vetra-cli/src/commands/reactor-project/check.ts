import { z } from "zod";
import { defineCommand } from "../../framework.js";
import {
  checkResultsFromOutcome,
  runChecks,
  runReducerTests,
  summarizeDiagnostics,
  type CheckScope,
} from "../../helpers/project-checks.js";
import { resolveReactorProjectPath } from "../../helpers/project.js";
import { attachCheckResults, type ObservedCheck } from "../../product/check-results.js";
import { runSmoke } from "../../product/smoke.js";
import { phBuildNodeOptions } from "../../helpers/node-memory.js";

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
  tests: z
    .boolean()
    .optional()
    .describe(
      "Also run the project's reducer tests and the preview smoke check (package builds; every editor/app module loads in the running preview; the example documents in seed/*.json fit the document models). Needed before finishing the Tests step. Defaults to false.",
    ),
});

export const reactorProjectCheck = defineCommand({
  id: "reactor-project-check",
  description:
    "Run TypeScript and ESLint over a Reactor project and report any diagnostics. Useful after hand-editing generated code or to verify a project compiles cleanly.",
  inputSchema,
  execute: async (
    { name, scope, skipLint, skipTypecheck, tests },
    { workdir, runProcess, services },
  ) => {
    const base = await resolveReactorProjectPath(workdir, name);
    const resolvedScope: CheckScope = scope ?? "all";

    const outcome = await runChecks(base, runProcess, {
      scope: resolvedScope,
      skipLint,
      skipTypecheck,
    });
    const { diagnostics, notes } = outcome;
    const observed: ObservedCheck[] = checkResultsFromOutcome(outcome, base);
    if (tests) {
      const reducerTests = await runReducerTests(base, runProcess);
      if (reducerTests) observed.push(reducerTests);
      else notes.push("reducer tests skipped: the project has no `test` script");
      const preview = services
        ?.list("reactor-project")
        .find((i) => i.workdir === base && i.status === "ready");
      observed.push(
        await runSmoke(base, {
          previewUrl: preview?.endpoints?.["vetra-studio"],
          build: (projectPath) =>
            runProcess("ph build", {
              timeout: 120_000,
              cwd: projectPath,
              env: { FORCE_COLOR: "1", NODE_OPTIONS: phBuildNodeOptions() },
            }),
        }),
      );
    }
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
    for (const r of observed.filter((o) => o.kind === "REDUCER_TESTS" || o.kind === "SMOKE")) {
      const label = r.kind === "SMOKE" ? "Preview smoke" : "Reducer tests";
      const why = r.detail ?? r.reason;
      lines.push(`${r.passed ? "✓" : "✗"} ${label}${why ? ` — ${why}` : ""}`);
    }

    return attachCheckResults({ text: lines.join("\n") }, observed);
  },
});
