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
import { missingMarkers } from "../../product/marker-check.js";
import { runSmoke } from "../../product/smoke.js";
import { getProductDoc, type ProductContext } from "../../product/product-doc.js";
import { phBuildNodeOptions } from "../../helpers/node-memory.js";
import { validateImports } from "../../workshop/import-files.js";

/* A stalled reactor must not hang the check. */
const PRODUCT_LOOKUP_TIMEOUT_MS = 5_000;

/** Workspaces known to hold a product document (a product document is never removed). */
const productWorkspaces = new Set<string>();

/**
 * Ruling X27: examples are required only in a Studio product workspace (one
 * with a product document). A positive answer is kept per workdir for the
 * process. A lookup that fails or stalls doesn't require examples this time,
 * and says so in a note.
 */
export async function examplesRequired(
  ctx: ProductContext & { workdir?: string },
): Promise<{ required: boolean; note?: string }> {
  const key = ctx.workdir;
  if (key && productWorkspaces.has(key)) return { required: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), PRODUCT_LOOKUP_TIMEOUT_MS);
    });
    const found = await Promise.race([getProductDoc(ctx), timeout]);
    if (found === "timeout") return { required: false, note: UNREADABLE_PRODUCT_NOTE };
    if (found && key) productWorkspaces.add(key);
    return { required: found !== null };
  } catch {
    return { required: false, note: UNREADABLE_PRODUCT_NOTE };
  } finally {
    clearTimeout(timer);
  }
}

export const UNREADABLE_PRODUCT_NOTE = "couldn't read the product — examples not required this time";

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
    context,
  ) => {
    const { workdir, runProcess, services } = context;
    const base = await resolveReactorProjectPath(workdir, name);
    const resolvedScope: CheckScope = scope ?? "all";

    const outcome = await runChecks(base, runProcess, {
      scope: resolvedScope,
      skipLint,
      skipTypecheck,
    });
    const { diagnostics, notes } = outcome;
    // Import files are a note: the agent fixes them, the customer isn't blocked.
    for (const file of validateImports(base)) {
      if (!file.ok) notes.push(`${file.file}: ${file.reason ?? "invalid"}`);
    }
    const observed: ObservedCheck[] = checkResultsFromOutcome(outcome, base);
    if (tests) {
      const examples = await examplesRequired(context);
      if (examples.note) notes.push(examples.note);
      const reducerTests = await runReducerTests(base, runProcess);
      if (reducerTests) observed.push(reducerTests);
      else notes.push("reducer tests skipped: the project has no `test` script");
      const preview = services
        ?.list("reactor-project")
        .find((i) => i.workdir === base && i.status === "ready");
      observed.push(
        await runSmoke(base, {
          requireExamples: examples.required,
          notes,
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
    const unmarked = missingMarkers(base);
    if (unmarked.length > 0) notes.push(`Add data-vetra-component to: ${unmarked.join(", ")}`);
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
