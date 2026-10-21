// Emit shared/*.ts (pure, dependency-free modules used by vetra-cli) next to the
// other dist outputs: dist/browser/shared/*.js and dist/node/shared/*.mjs.
// Types come from the tsc declaration emit (dist/types/shared).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ts = createRequire(import.meta.url)("typescript");
const files = readdirSync(`${root}shared`).filter(
  (f) => f.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(f),
);
for (const [dir, ext] of [
  ["dist/browser/shared", ".js"],
  ["dist/node/shared", ".mjs"],
]) {
  mkdirSync(`${root}${dir}`, { recursive: true });
  for (const f of files) {
    const { outputText } = ts.transpileModule(
      readFileSync(`${root}shared/${f}`, "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    );
    writeFileSync(`${root}${dir}/${f.replace(/\.ts$/, ext)}`, outputText);
  }
}
