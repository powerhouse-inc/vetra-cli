// Guard: vetra ships zero declared runtime deps — everything is bundled by
// tsdown or vendored into dist/node_modules. Fails the build/CI if that breaks.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VENDOR } from "./vendor-list.ts";

const pkgPath = resolve(import.meta.dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const errors: string[] = [];

for (const field of ["dependencies", "optionalDependencies"]) {
  const names = Object.keys(pkg[field] ?? {});
  if (names.length)
    errors.push(
      `${field} must be empty (found: ${names.join(", ")}). Bundle it via tsdown, or add it to scripts/vendor-list.ts and devDependencies — never declare it in ${field}.`,
    );
}

const dev = pkg.devDependencies ?? {};
const missing = VENDOR.filter((n) => !(n in dev));
if (missing.length)
  errors.push(
    `vendored deps missing from devDependencies: ${missing.join(", ")}. The vendor step installs from devDependencies, so add them there.`,
  );

if (errors.length) {
  console.error("[check:deps] FAILED — runtime-dep invariant broken:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(
  `[check:deps] ok — 0 declared runtime deps, ${VENDOR.length} vendored deps present in devDependencies`,
);
