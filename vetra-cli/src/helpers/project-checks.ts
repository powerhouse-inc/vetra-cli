import fs from "node:fs";
import path from "node:path";
import { checkNodeOptions } from "./node-memory.js";

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
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
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

interface OxlintDiagnostic {
  message: string;
  code: string;
  severity: string;
  filename: string;
  labels?: Array<{ span?: { line?: number; column?: number } }>;
}

/* oxlint `code` is `<plugin>(<rule-or-TScode>)`; inner `TS\d+` is a tsc
 * compiler diagnostic, anything else is a lint rule. */
const OXLINT_CODE = /^(\w+)\((.+)\)$/;
const TS_CODE = /^TS\d+$/;

function parseOxlintOutput(
  output: string,
  base: string,
  scope: CheckScope,
): GenDiagnostic[] {
  // oxlint --format json prints one object `{ "diagnostics": [...] }` (plus
  // trailing summary keys); extract from first `{` to last `}`.
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: { diagnostics?: OxlintDiagnostic[] };
  try {
    parsed = JSON.parse(output.slice(start, end + 1)) as {
      diagnostics?: OxlintDiagnostic[];
    };
  } catch {
    return [];
  }
  const out: GenDiagnostic[] = [];
  for (const d of parsed.diagnostics ?? []) {
    const m = OXLINT_CODE.exec(d.code);
    const inner = m ? m[2] : d.code;
    const source: GenDiagnostic["source"] = TS_CODE.test(inner)
      ? "tsc"
      : "eslint";
    const span = d.labels?.[0]?.span;
    const abs = path.resolve(base, d.filename);
    if (!inScope(abs, scope)) continue;
    out.push({
      source,
      file: toRel(base, abs),
      line: span?.line ?? 0,
      column: span?.column ?? 0,
      severity: d.severity === "warning" ? "warning" : "error",
      code: inner,
      message: d.message,
    });
  }
  return out;
}

function globsFor(base: string, dirs: string[]): string {
  return dirs
    .flatMap((d) => [`"${base}/${d}/**/*.ts"`, `"${base}/${d}/**/*.tsx"`])
    .join(" ");
}

/* Eslint path args: `.ts`/`.tsx` globs for present module dirs (`.` for `all`).
 * `null` if `module` finds none. */
function eslintTargets(base: string, scope: CheckScope): string | null {
  if (scope === "all") return ".";
  const present = MODULE_DIRS.filter((d) => fs.existsSync(path.join(base, d)));
  if (present.length === 0) return null;
  return globsFor(base, present);
}

/* oxlint targets: present module dirs for `module`, `.` for `all`.
 * `null` if `module` finds none. */
function oxlintTargets(base: string, scope: CheckScope): string | null {
  if (scope === "all") return ".";
  const present = MODULE_DIRS.filter((d) => fs.existsSync(path.join(base, d)));
  if (present.length === 0) return null;
  return present.join(" ");
}

/* Single oxlint pass replacing tsc+eslint when the project has it installed.
 * Always runs --type-check + --type-aware, then drops sources per skip flags. */
async function runOxlint(
  oxlint: string,
  base: string,
  runProcess: RunProcess,
  opts: { scope: CheckScope; skipTypecheck?: boolean; skipLint?: boolean },
): Promise<CheckOutcome> {
  const diagnostics: GenDiagnostic[] = [];
  const notes: string[] = [];
  const targets = oxlintTargets(base, opts.scope);
  if (targets === null) {
    notes.push("checks skipped: no module directories present to check");
    return { diagnostics, notes };
  }
  const tsconfig = path.join(base, "tsconfig.json");
  const tsconfigArg = fs.existsSync(tsconfig) ? ` --tsconfig "${tsconfig}"` : "";
  const { success, output } = await runProcess(
    `"${oxlint}" --type-aware --type-check --format json${tsconfigArg} ${targets}`,
    { cwd: base, timeout: 120_000, env: { NODE_OPTIONS: checkNodeOptions() } },
  );
  let found = parseOxlintOutput(output, base, opts.scope);
  if (opts.skipTypecheck) found = found.filter((d) => d.source !== "tsc");
  if (opts.skipLint) found = found.filter((d) => d.source !== "eslint");
  diagnostics.push(...found);
  // oxlint exits non-zero when it reports findings (expected); a non-zero exit
  // with nothing parsed means the run itself failed.
  if (!success && found.length === 0) {
    notes.push(`checks failed to run: ${tailOutput(output)}`);
  }
  return { diagnostics, notes };
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

  if (opts.skipTypecheck && opts.skipLint) return { diagnostics, notes };

  // oxlint (when installed) runs both lint + TS diagnostics in one pass; use it
  // instead of the separate tsc+eslint passes. Falls back when absent.
  const oxlint = binPath(base, "oxlint");
  if (oxlint) {
    return runOxlint(oxlint, base, runProcess, {
      scope,
      skipTypecheck: opts.skipTypecheck,
      skipLint: opts.skipLint,
    });
  }

  if (!opts.skipTypecheck) {
    const tsc = binPath(base, "tsc");
    if (!tsc) {
      notes.push("typecheck skipped: tsc not found in project node_modules");
    } else {
      const { success, output } = await runProcess(
        `"${tsc}" --noEmit --pretty false`,
        { cwd: base, timeout: 120_000, env: { NODE_OPTIONS: checkNodeOptions() } },
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
          `"${eslint}" --no-error-on-unmatched-pattern --format json ${eslintArgs}`,
          { cwd: base, timeout: 120_000, env: { NODE_OPTIONS: checkNodeOptions() } },
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
