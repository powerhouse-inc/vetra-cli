# Vetra agent memory — accurate per-process breakdown (2026-06-11)

Measured with an in-process reporter (`vetra-cli/scripts/mem-reporter.mjs`, loaded
via `node --import`, inherited across the whole tree) capturing
`process.memoryUsage()` + `v8.getHeapStatistics()`. Aggregated by
`scripts/mem-summary.mjs`; heap composition via `scripts/heap-top.mjs`
(SIGUSR2 writes a `.heapsnapshot`). Container limit M = 8 GB; cluster pods
run ~4.1–4.7 GB working set.

## Production (dist image `vetra-cli:dev9`), IDLE (no reactor project)
- **agent-main: peak 2022 MB** (settles ~1.4 GB): **V8 heapUsed 1272 MB**,
  external 426 MB (≈ PGlite WASM ArrayBuffer), native 255 MB.
- connect helper: 56 MB.

## LOADED (+ reactor project `ph vetra` running) — source/lab run
- **reactor-project (ph vetra): peak 2682 MB**: heap 427 MB, external 477 MB
  (PGlite WASM), **native 1778 MB** (Vite dev server + esbuild).
- agent-main: ~1.7 GB (same components as above).
- Sum ≈ 4.5 GB — matches the cluster.

## Heap composition (source-run snapshot, by V8 node type)
- **467 MB `native:system / JSArrayBufferData`** = PGlite WASM memory.
- **290 MB strings** = loaded module source + sourcemaps (bundled package code;
  in source-run also the TS compiler/tsx/prettier — a source-run-only inflation).
- 141 MB arrays, 49 MB code, 45 MB closures.

## The real consumers, ranked
1. **`ph vetra` native ~1.78 GB** (Vite dev server + esbuild) — only present while
   a reactor project is running. Lives in ph-cli's `ph vetra`.
2. **agent-main V8 heap ~0.85–1.27 GB** — eager-loaded code/closures of the full
   stack (Mastra AI agent, all @powerhousedao packages, document models,
   switchboard, Vite-for-studio) + reactor in-memory state.
3. **PGlite WASM ~426–527 MB per reactor instance** (two instances when loaded).

## What does NOT help (disproven earlier)
- Node heap caps (`--max-old-space-size`) — don't reduce native/WASM; only guard runaway.
- PGlite `initdb`-in-subprocess — cold pages drop from RSS anyway; no steady win.
- PGlite GUCs / `initialMemory` — not exposed / negligible.
