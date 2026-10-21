/**
 * "Edit text in place" (P4-M3, Task 3.5): find the one place a label appears
 * (a whole JSX text node or a whole string literal) and change it through
 * `applyStudioEdit`, so the edit is an ordinary change with checks. Anything
 * ambiguous — two places, or the same words inside a longer string — is not
 * written; the Studio sends the customer's words to the agent instead.
 *
 * Searched: every reactor project's `editors/`, `apps/` and
 * `document-models/*\/src/`; never `gen/`, `node_modules/`, `dist/`, or test
 * files. Comparison ignores HTML entities and whitespace differences.
 */
import fs from "node:fs";
import path from "node:path";
import { applyStudioEdit, type StudioEditContext } from "./studio-edit.js";

export interface LiteralMatch {
  /** Workspace-relative file path. */
  file: string;
  /** Offset of the literal text's first character. */
  index: number;
}

export interface TextEditOutcome {
  applied: boolean;
  changeId?: string;
  /** How many places the old text was found. */
  matches: number;
}

const SKIP_DIRS: Record<string, true> = {
  gen: true,
  node_modules: true,
  dist: true,
  ".git": true,
  ".ph": true,
};
const SOURCE_FILE = /\.(?:tsx|jsx|ts|js)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Comparison form: entities decoded, whitespace collapsed. */
export function normalizeText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** The reactor projects directly under the workspace. */
function projectDirs(workdir: string): string[] {
  return fs
    .readdirSync(workdir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(workdir, entry.name, "powerhouse.config.json")),
    )
    .map((entry) => entry.name);
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS[entry.name] || entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(abs);
    }
  }
}

/** The project's editable source files (workspace-relative). */
function sourceFiles(workdir: string, project: string): string[] {
  const base = path.join(workdir, project);
  const roots = [path.join(base, "editors"), path.join(base, "apps")];
  const models = path.join(base, "document-models");
  if (fs.existsSync(models)) {
    for (const entry of fs.readdirSync(models, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(models, entry.name, "src"));
    }
  }
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  return files.map((file) => path.relative(workdir, file));
}

/** Offsets where `wanted` appears inside a string literal or a JSX text node. */
function literalIndexes(source: string, wanted: string): number[] {
  const found: number[] = [];
  let i = 0;
  while (i < source.length) {
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      i += 1;
      continue;
    }
    // An apostrophe in a word ("don't") is not a string literal.
    const before = source[i - 1];
    if (quote === "'" && before && /[\p{L}\p{N}]/u.test(before)) {
      i += 1;
      continue;
    }
    const start = i + 1;
    let end = start;
    let escaped = false;
    while (end < source.length) {
      const char = source[end];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) break;
      end += 1;
    }
    if (end >= source.length) break;
    const content = source.slice(start, end);
    if (quote !== "`" || !content.includes("${")) {
      if (normalizeText(content).includes(wanted)) found.push(start);
    }
    i = end + 1;
  }
  for (const match of source.matchAll(/(?<=>)([^<>{}]+)(?=<)/g)) {
    const text = match[1];
    if (normalizeText(text).includes(wanted)) {
      found.push(match.index ?? 0);
    }
  }
  return found;
}

/** Every place `text` appears as a label or a string literal. */
export function findLiteral(workdir: string, text: string): LiteralMatch[] {
  const wanted = normalizeText(text);
  if (!wanted) return [];
  const matches: LiteralMatch[] = [];
  for (const project of projectDirs(workdir)) {
    for (const file of sourceFiles(workdir, project)) {
      const source = fs.readFileSync(path.join(workdir, file), "utf8");
      for (const index of literalIndexes(source, wanted)) {
        matches.push({ file, index });
      }
    }
  }
  return matches.sort(
    (a, b) => a.file.localeCompare(b.file) || a.index - b.index,
  );
}

/**
 * `source` with the one match at `index` replaced by `newText`, or null when
 * that occurrence is not a whole literal/text node (the old text sits inside
 * a longer string).
 */
export function rewriteLiteral(
  source: string,
  index: number,
  oldText: string,
  newText: string,
): string | null {
  const wanted = normalizeText(oldText);
  const before = source[index - 1];
  if (before === '"' || before === "'" || before === "`") {
    let end = index;
    let escaped = false;
    while (end < source.length) {
      const char = source[end];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === before) break;
      end += 1;
    }
    if (end >= source.length) return null;
    const content = source.slice(index, end);
    if (normalizeText(content) !== wanted) return null;
    return source.slice(0, index) + newText + source.slice(end);
  }
  if (before === ">") {
    const end = source.indexOf("<", index);
    if (end === -1) return null;
    const content = source.slice(index, end);
    if (normalizeText(content) !== wanted) return null;
    return source.slice(0, index) + newText + source.slice(end);
  }
  return null;
}

/**
 * The text edit as a Studio change: exactly one whole match is written and
 * committed through `applyStudioEdit`; anything else returns applied: false
 * with the number of places found.
 */
export async function applyTextEdit(
  ctx: StudioEditContext,
  oldText: string,
  newText: string,
): Promise<TextEditOutcome> {
  const matches = findLiteral(ctx.workdir, oldText);
  if (matches.length !== 1) return { applied: false, matches: matches.length };
  const match = matches[0];
  const source = fs.readFileSync(path.join(ctx.workdir, match.file), "utf8");
  const next = rewriteLiteral(source, match.index, oldText, newText);
  if (next === null) return { applied: false, matches: 1 };
  const label = `Changed label '${oldText}' → '${newText}'`;
  const result = await applyStudioEdit(ctx, {
    request: `Change the text '${oldText}' to '${newText}'`,
    milestone: label,
    outcome: label,
    async write(workdir) {
      fs.writeFileSync(path.join(workdir, match.file), next);
      return [match.file];
    },
  });
  return { applied: true, changeId: result.changeId, matches: 1 };
}
