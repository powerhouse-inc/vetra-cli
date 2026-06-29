/**
 * Deterministic content fingerprint for a reactor-project, used to decide
 * whether a project needs a new release. The hash covers the project's *source*
 * — the inputs that determine the build — and excludes build output, codegen,
 * dependency installs, runtime state, and VCS metadata, so it is stable across
 * machines and tool versions. It is embedded in the published package and
 * compared on each release check.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Directory names excluded anywhere in the tree. `gen` and `dist` are codegen
 * / build output (a function of source + tool version), so hashing them would
 * break cross-machine determinism. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  ".ph",
  ".git",
  "coverage",
  "gen",
]);

/** package.json field (under `powerhouse`) where the content hash is embedded
 * at publish time. */
export const CONTENT_HASH_FIELD = "contentHash";

function isExcludedFile(name: string): boolean {
  return (
    name.endsWith(".tsbuildinfo") ||
    name.endsWith(".map") ||
    name === ".eslintcache" ||
    name === "pnpm-lock.yaml" ||
    name === "package-lock.json" ||
    name === "yarn.lock" ||
    name === ".DS_Store"
  );
}

/** Included files as POSIX relative paths, sorted. Symlinks are skipped (they
 * are neither isFile nor isDirectory). */
async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (isExcludedFile(entry.name)) continue;
        out.push(path.join(dir, entry.name));
      }
    }
  }
  await walk(root);
  return out
    .map((abs) => path.relative(root, abs).split(path.sep).join("/"))
    .sort();
}

/** Stable JSON serialization with sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** Normalize package.json for hashing: drop `version` and the embedded content
 * hash so a version bump or the hash itself never changes the fingerprint;
 * sort keys for stable bytes. Dependency changes still count. */
function normalizePackageJson(raw: string): string {
  const json = JSON.parse(raw) as Record<string, unknown>;
  delete json.version;
  const ph = json.powerhouse;
  if (ph && typeof ph === "object") {
    const obj = ph as Record<string, unknown>;
    delete obj[CONTENT_HASH_FIELD];
    // Drop an emptied `powerhouse` so embedding the hash is indistinguishable
    // from never having had the key (the field is added at publish time).
    if (Object.keys(obj).length === 0) delete json.powerhouse;
  }
  return stableStringify(json);
}

export async function computeProjectContentHash(
  projectPath: string,
): Promise<string> {
  const files = await collectFiles(projectPath);
  const hash = createHash("sha256");
  for (const rel of files) {
    const abs = path.join(projectPath, rel);
    const bytes =
      rel === "package.json"
        ? Buffer.from(
            normalizePackageJson(await readFile(abs, "utf-8")),
            "utf-8",
          )
        : await readFile(abs);
    hash.update(rel, "utf-8");
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}
