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
];
