// Guard: every runtime `__require("<x>")` or unbundled `import("<x>")` tsdown
// leaves in dist/*.js must resolve in a global install, which has nothing but
// dist (vetra ships zero runtime deps). Allowed: Node builtins, vendored deps (vendor-list.ts),
// tsdown externals (vendored or absent by design), and OPTIONAL — requires that
// sit behind a try/catch or a feature probe, or in chunks no boot path loads.
// Anything else crashes at runtime with `Cannot find module`, so fail the build.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import tsdownConfig from "../tsdown.config.ts";
import { VENDOR } from "./vendor-list.ts";
import { findBareDynamicImports } from "./dynamic-imports.ts";

type Matcher = string | RegExp;

// Each entry verified in the built dist (Powerhouse 6.2.3 / ph-clint 0.1.0-dev.105).
const OPTIONAL: Matcher[] = [
  // lucide-react in the mermaid/ChatSession chunk cluster, which no import
  // from main.js reaches.
  "react",
  // node-fetch: `try { convert = __require("encoding").convert } catch {}`.
  "encoding",
  // tailwind build chunk, never imported from main.js.
  "postcss",
  // rolldown's napi loader tries each platform binding in try/catch.
  /^@rolldown\/binding-/,
  /^\.\.?\/rolldown-binding\./,
  // pg: `try { Native = __require("pg-native") } catch {}`.
  "pg-native",
  // Yarn PnP probes, both in try/catch.
  "pnpapi",
  // prettier-plugin-svelte, loaded only when codegen formats svelte.
  "svelte/compiler",
  // postcss-import: `try { sugarss = __require("sugarss") } catch {}`.
  "sugarss",
  // @mastra/core channels (`await import(mod)` with mod = "chat"); unused.
  "chat",
  // @mastra/core's ast-grep search: probed with require.resolve in try/catch.
  "@ast-grep/napi",
];

const distDir = resolve(import.meta.dirname, "..", "dist");
const config = (Array.isArray(tsdownConfig) ? tsdownConfig[0] : tsdownConfig) as {
  external?: Matcher[];
};
const EXTERNAL: Matcher[] = config.external ?? [];
const builtins = new Set(builtinModules);

function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function matches(list: Matcher[], spec: string): boolean {
  const pkg = packageName(spec);
  return list.some((m) =>
    typeof m === "string" ? m === spec || m === pkg : m.test(spec),
  );
}

function allowed(spec: string, file: string): boolean {
  if (spec.startsWith("node:") || builtins.has(spec)) return true;
  if (builtins.has(packageName(spec))) return true;
  if (matches(OPTIONAL, spec)) return true;
  if (spec.startsWith(".")) return existsSync(join(dirname(file), spec));
  return VENDOR.includes(packageName(spec)) || matches(EXTERNAL, spec);
}

const REQUIRE = /__require\(\s*["']([^"']+)["']\s*\)/g;
const offenders = new Map<string, Set<string>>();
let scanned = 0;
for (const name of readdirSync(distDir)) {
  if (!name.endsWith(".js")) continue;
  const file = join(distDir, name);
  scanned++;
  const code = readFileSync(file, "utf8");
  const specs = [...[...code.matchAll(REQUIRE)].map((m) => m[1]), ...findBareDynamicImports(code)];
  for (const spec of specs) {
    if (allowed(spec, file)) continue;
    const files = offenders.get(spec) ?? new Set<string>();
    files.add(name);
    offenders.set(spec, files);
  }
}

if (offenders.size) {
  console.error(
    "[check:requires] FAILED — dist requires modules a global install won't have:",
  );
  for (const [spec, files] of offenders)
    console.error(`  - ${spec}  (${[...files].slice(0, 3).join(", ")})`);
  console.error(
    "Vendor it (scripts/vendor-list.ts + tsdown external + devDependencies), or, if it is guarded by try/catch or never loaded, add it to OPTIONAL in scripts/check-runtime-requires.ts.",
  );
  process.exit(1);
}
console.log(`[check:requires] ok — ${scanned} dist files, no unvendored runtime requires`);
