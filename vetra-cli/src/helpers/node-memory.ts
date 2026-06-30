/**
 * Per-role Node heap caps for spawned processes.
 *
 * The agent forks several Node processes (reactor-project / ph vetra, ph init,
 * ph build). Without per-spawn caps a single high
 * `--max-old-space-size` is inherited by every child fork, multiplying rather
 * than bounding heap. Each role gets its own conservative cap here.
 *
 * Caveats: a heap cap is not an RSS cap (off-heap buffers, native deps, and
 * other v8 spaces are not bounded). Defaults are conservative starting points
 * to be tuned against the k8s container limit. Each cap reads an env override
 * so values can be swept during Docker repro without rebuilding the image.
 *
 * Env knobs (megabytes):
 *   VETRA_MEM_REACTOR_PROJECT_MB  reactor-project / ph vetra   (default 2048)
 *   VETRA_MEM_PH_INIT_MB          ph init                      (default 2048)
 *   VETRA_MEM_PH_BUILD_MB         ph build                     (default 2048)
 *   VETRA_MEM_CHECK_MB            tsc / eslint codegen checks   (default 1024)
 */

function maxOldSpaceMb(envVar: string, fallbackMb: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallbackMb;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
}

function nodeOptions(envVar: string, fallbackMb: number): string {
  return `--max-old-space-size=${maxOldSpaceMb(envVar, fallbackMb)} --max-semi-space-size=64`;
}

export function reactorProjectNodeOptions(): string {
  return nodeOptions('VETRA_MEM_REACTOR_PROJECT_MB', 2048);
}

export function phInitNodeOptions(): string {
  return nodeOptions('VETRA_MEM_PH_INIT_MB', 2048);
}

export function phBuildNodeOptions(): string {
  return nodeOptions('VETRA_MEM_PH_BUILD_MB', 2048);
}

export function checkNodeOptions(): string {
  return nodeOptions('VETRA_MEM_CHECK_MB', 1024);
}
