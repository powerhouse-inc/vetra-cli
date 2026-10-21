// Emit shared/*.ts (pure, dependency-free modules used by vetra-cli) next to the
// other dist outputs: dist/browser/shared/*.js and dist/node/shared/*.mjs.
// Types come from the tsc declaration emit (dist/types/shared).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");
const files = readdirSync("shared").filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
);
for (const [dir, ext] of [
  ["dist/browser/shared", ".js"],
  ["dist/node/shared", ".mjs"],
]) {
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const { outputText } = ts.transpileModule(
      readFileSync(`shared/${f}`, "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    );
    writeFileSync(`${dir}/${f.replace(/\.ts$/, ext)}`, outputText);
  }
}
