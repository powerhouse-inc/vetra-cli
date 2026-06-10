import fs from "node:fs";
import path from "node:path";

export interface GenDiagnostic {
  source: "tsc" | "eslint";
  file: string; // relative to project base
  line: number;
  column: number;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface CheckOutcome {
  diagnostics: GenDiagnostic[];
  /** Why a check didn't run (binary missing, timeout, spawn error). */
  notes: string[];
}

export type CheckScope = "module" | "all";

type RunProcess = (
  command: string,
  opts?: { cwd?: string; timeout?: number },
) => Promise<{ success: boolean; output: string }>;

const SEP = path.sep;

/** Last `max` chars of captured output, for surfacing a run failure in a note. */
function tailOutput(output: string, max = 1000): string {
  const trimmed = output.trim();
  if (!trimmed) return "(no output captured)";
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

/** Top-level directories the codegen writes spec-authored code into (the kinds
 * in `pruneManifestSection`). Each holds a per-artifact subtree — for document
 * models that is `gen/` output plus the editable `src/` implementation; editors,
 * apps, processors, and subgraphs have their own layouts. The check covers the
 * whole subtree, not just `gen/`, so a malformed reducer in `src/` is caught. */
const MODULE_DIRS = [
  "document-models",
  "editors",
  "apps",
  "processors",
  "subgraphs",
] as const;

/** True for any file under one of the spec-authored module trees. */
export function isModulePath(absPath: string): boolean {
  return MODULE_DIRS.some((d) => absPath.includes(`${SEP}${d}${SEP}`));
}

function inScope(absPath: string, scope: CheckScope): boolean {
  return scope === "all" || isModulePath(absPath);
}

function toRel(base: string, absPath: string): string {
  return path.relative(base, absPath) || absPath;
}

function binPath(base: string, name: string): string | null {
  const p = path.join(base, "node_modules", ".bin", name);
  return fs.existsSync(p) ? p : null;
}

/**
 * tsc --pretty false emits lines like:
 *   document-models/x/v1/gen/actions.ts(10,5): error TS1109: Expression expected.
 * Multi-line messages indent continuation lines; we keep only the leading line
 * (matches what tsc reports as the diagnostic head).
 */
const TSC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/;

function parseTscOutput(
  output: string,
  base: string,
  scope: CheckScope,
): GenDiagnostic[] {
  const out: GenDiagnostic[] = [];
  for (const raw of output.split("\n")) {
    const m = TSC_LINE.exec(raw);
    if (!m) continue;
    const [, file, line, col, severity, code, message] = m;
    const abs = path.isAbsolute(file) ? file : path.resolve(base, file);
    if (!inScope(abs, scope)) continue;
    out.push({
      source: "tsc",
      file: toRel(base, abs),
      line: Number(line),
      column: Number(col),
      severity: severity as "error" | "warning",
      code,
      message,
    });
  }
  return out;
}

interface EslintResult {
  filePath: string;
  messages: Array<{
    ruleId: string | null;
    severity: 1 | 2;
    line?: number;
    column?: number;
    message: string;
    fatal?: boolean;
  }>;
}

function parseEslintOutput(
  output: string,
  base: string,
): GenDiagnostic[] {
  // eslint --format json prints a single JSON array; extract it (anything
  // printed to stderr by surrounding wrappers is ignored).
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: EslintResult[];
  try {
    parsed = JSON.parse(output.slice(start, end + 1)) as EslintResult[];
  } catch {
    return [];
  }
  const out: GenDiagnostic[] = [];
  for (const r of parsed) {
    for (const m of r.messages) {
      out.push({
        source: "eslint",
        file: toRel(base, r.filePath),
        line: m.line ?? 0,
        column: m.column ?? 0,
        severity: m.severity === 2 ? "error" : "warning",
        code: m.ruleId ?? (m.fatal ? "fatal" : "lint"),
        message: m.message,
      });
    }
  }
  return out;
}

/**
 * Build the eslint path arguments for a scope. Returns `null` when a scoped run
 * has nothing to lint (so the caller can skip rather than invoke eslint with a
 * pattern that matches no files).
 */
function eslintTargets(base: string, scope: CheckScope): string | null {
  if (scope === "all") return ".";
  const present = MODULE_DIRS.filter((d) => fs.existsSync(path.join(base, d)));
  if (present.length === 0) return null;
  return present
    .flatMap((d) => [`"${base}/${d}/**/*.ts"`, `"${base}/${d}/**/*.tsx"`])
    .join(" ");
}

export async function runChecks(
  base: string,
  runProcess: RunProcess,
  opts: {
    scope?: CheckScope;
    skipTypecheck?: boolean;
    skipLint?: boolean;
  } = {},
): Promise<CheckOutcome> {
  const scope: CheckScope = opts.scope ?? "all";
  const diagnostics: GenDiagnostic[] = [];
  const notes: string[] = [];

  if (!opts.skipTypecheck) {
    const tsc = binPath(base, "tsc");
    if (!tsc) {
      notes.push("typecheck skipped: tsc not found in project node_modules");
    } else {
      const { success, output } = await runProcess(
        `"${tsc}" --noEmit --pretty false`,
        { cwd: base, timeout: 120_000 },
      );
      const found = parseTscOutput(output, base, scope);
      diagnostics.push(...found);
      // tsc exits non-zero when it reports diagnostics (expected); only a
      // non-zero exit with nothing parsed means the run itself failed.
      if (!success && found.length === 0) {
        notes.push(`typecheck failed to run: ${tailOutput(output)}`);
      }
    }
  }

  if (!opts.skipLint) {
    const eslint = binPath(base, "eslint");
    if (!eslint) {
      notes.push("lint skipped: eslint not found in project node_modules");
    } else {
      const eslintArgs = eslintTargets(base, scope);
      if (eslintArgs === null) {
        notes.push("lint skipped: no module directories present to lint");
      } else {
        const { success, output } = await runProcess(
          `"${eslint}" --format json ${eslintArgs}`,
          { cwd: base, timeout: 120_000 },
        );
        const found = parseEslintOutput(output, base);
        diagnostics.push(...found);
        // eslint exits non-zero when it reports errors (expected); a non-zero
        // exit with no parseable JSON means the run itself failed.
        if (!success && found.length === 0) {
          notes.push(`lint failed to run: ${tailOutput(output)}`);
        }
      }
    }
  }

  return { diagnostics, notes };
}

export function summarizeDiagnostics(diagnostics: GenDiagnostic[]): {
  errors: number;
  warnings: number;
  tsc: number;
  eslint: number;
} {
  let errors = 0;
  let warnings = 0;
  let tsc = 0;
  let eslint = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") errors++;
    else warnings++;
    if (d.source === "tsc") tsc++;
    else eslint++;
  }
  return { errors, warnings, tsc, eslint };
}
