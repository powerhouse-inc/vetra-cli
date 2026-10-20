// Bundler file-URL placeholders (`import.meta.ROLLDOWN_FILE_URL_<ref>` /
// `import.meta.ROLLUP_FILE_URL_<ref>`) must be resolved at build time. One left
// in shipped JS evaluates to `undefined` in the browser, so `new URL(undefined,
// import.meta.url)` fetches `<dir>/undefined` — the SPA fallback HTML. That is
// how a rolldown older than the vite builder-tools uses broke the studio:
// PGlite got index.html as its FS bundle ("Invalid FS bundle size").
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const UNRESOLVED_FILE_URL = /import\.meta\.(?:ROLLDOWN|ROLLUP)_FILE_URL_\w+/;

export function findUnresolvedFileUrls(dir: string): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const file = join(entry.parentPath, entry.name);
    const m = readFileSync(file, "utf8").match(UNRESOLVED_FILE_URL);
    if (m) hits.push(`${file}: ${m[0]}`);
  }
  return hits.sort();
}
