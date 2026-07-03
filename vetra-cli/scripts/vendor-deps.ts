// Vendor un-bundleable runtime deps into dist/node_modules so the published
// package carries them with no consumer-side registry resolution.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VENDOR } from "./vendor-list.ts";

const pkgRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(pkgRoot, "..");
const distNodeModules = join(pkgRoot, "dist", "node_modules");

// Versions read from the resolved install so the vendored copy matches the bundle.
function installedVersion(name: string): string {
  const p = join(pkgRoot, "node_modules", name, "package.json");
  if (!existsSync(p))
    throw new Error(`[vendor] ${name} not installed; run pnpm install first`);
  return JSON.parse(readFileSync(p, "utf8")).version as string;
}

const deps = Object.fromEntries(VENDOR.map((n) => [n, installedVersion(n)]));

const tmp = mkdtempSync(join(tmpdir(), "vetra-vendor-"));
try {
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify(
      { name: "vetra-vendor", version: "0.0.0", private: true, dependencies: deps },
      null,
      2,
    ),
  );
  // Flat + all-platform natives (pnpm 11 reads from pnpm-workspace.yaml).
  // strictDepBuilds:false: never run dep builds, just copy bundled prebuilds.
  writeFileSync(
    join(tmp, "pnpm-workspace.yaml"),
    [
      "nodeLinker: hoisted",
      "strictDepBuilds: false",
      "supportedArchitectures:",
      "  os: [darwin, linux, win32]",
      "  cpu: [x64, arm64]",
      "  libc: [glibc, musl]",
      "",
    ].join("\n"),
  );
  // Inherit registry/scope config + the codegen-strip hook from the workspace.
  for (const f of [".npmrc", ".pnpmfile.cjs"]) {
    const src = join(workspaceRoot, f);
    if (existsSync(src)) cpSync(src, join(tmp, f));
  }

  console.log(`[vendor] installing ${VENDOR.length} deps (all-platform) in ${tmp}`);
  for (const [n, v] of Object.entries(deps)) console.log(`  ${n}@${v}`);
  // No --ignore-workspace: it would drop the pnpm-workspace.yaml settings
  // (nodeLinker + supportedArchitectures). tmp is outside any repo workspace.
  execFileSync("pnpm", ["install", "--config.minimumReleaseAge=0"], {
    cwd: tmp,
    stdio: "inherit",
  });

  rmSync(distNodeModules, { recursive: true, force: true });
  cpSync(join(tmp, "node_modules"), distNodeModules, { recursive: true });
  // .bin shims are absolute symlinks into the temp dir (dangling once it's
  // gone) and unused at runtime; drop them so the tree has no broken links.
  for (const dir of globSync(join(distNodeModules, "**/.bin")))
    rmSync(dir, { recursive: true, force: true });
  console.log(`[vendor] wrote ${distNodeModules}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
