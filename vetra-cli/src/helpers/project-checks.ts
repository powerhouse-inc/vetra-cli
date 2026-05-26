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

export type CheckScope = "generated" | "all";

type RunProcess = (
  command: string,
  opts?: { cwd?: string; timeout?: number },
) => Promise<{ success: boolean; output: string }>;

const SEP = path.sep;

export function isGeneratedPath(absPath: string): boolean {
  return absPath.includes(`${SEP}gen${SEP}`);
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
    if (scope === "generated" && !isGeneratedPath(abs)) continue;
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
      const { output } = await runProcess(
        `"${tsc}" --noEmit --pretty false`,
        { cwd: base, timeout: 120_000 },
      );
      diagnostics.push(...parseTscOutput(output, base, scope));
    }
  }

  if (!opts.skipLint) {
    const eslint = binPath(base, "eslint");
    if (!eslint) {
      notes.push("lint skipped: eslint not found in project node_modules");
    } else {
      const eslintArgs =
        scope === "generated"
          ? `"${base}/**/gen/**/*.ts" "${base}/**/gen/**/*.tsx"`
          : `.`;
      const { output } = await runProcess(
        `"${eslint}" --format json ${eslintArgs}`,
        { cwd: base, timeout: 120_000 },
      );
      diagnostics.push(...parseEslintOutput(output, base));
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
