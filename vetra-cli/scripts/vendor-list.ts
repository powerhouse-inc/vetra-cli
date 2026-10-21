// Native/WASM/singleton leaves that can't be bundled by tsdown. Single source
// of truth for vendor-deps.ts (vendors them) and check-runtime-deps.ts (asserts them).
export const VENDOR = [
  "libsql",
  "@datadog/pprof",
  "@electric-sql/pglite",
  "@powerhousedao/pglite-fs",
  "graphql",
  "devcert",
  "fsevents",
  // Required at runtime (createRequire) by @powerhousedao/shared's CLI helpers
  // (`semver/functions/*`), which tsdown leaves unbundled.
  "semver",
  // Loaded by @mastra/core's LocalSandbox through `await import(mod)` with a
  // variable specifier, so tsdown can't bundle it: without it the workspace
  // shell (mastra_workspace_execute_command) fails in a global install.
  "execa",
];
