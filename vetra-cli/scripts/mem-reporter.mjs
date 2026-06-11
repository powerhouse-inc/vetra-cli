/**
 * Per-process memory reporter. Loaded via `node --import` so it attaches to
 * every Node process in the agent tree (main, reactor-project/ph vetra, the
 * Vite dev server it forks, connect, registry, …).
 *
 * Opt-in: a no-op unless VETRA_MEM_PROFILE_DIR is set. When set, each process
 * appends one JSONL sample every VETRA_MEM_PROFILE_INTERVAL_MS (default 2000)
 * to <dir>/<role>-<pid>.jsonl, capturing the RSS and the V8-heap-vs-native
 * split so we can see what actually holds memory (PGlite WASM + Vite are
 * native; they show up as rss - heapTotal - external - arrayBuffers).
 *
 * The interval is unref'd so it never keeps a process alive; a final sample is
 * written on beforeExit and SIGTERM/SIGINT.
 */
import v8 from 'node:v8';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.VETRA_MEM_PROFILE_DIR;
if (dir) {
  const intervalMs = Number.parseInt(
    process.env.VETRA_MEM_PROFILE_INTERVAL_MS ?? '2000',
    10,
  );

  const role = deriveRole();
  const file = join(dir, `${role}-${process.pid}.jsonl`);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* dir may exist */
  }

  const sample = (phase) => {
    try {
      const m = process.memoryUsage();
      const h = v8.getHeapStatistics();
      // native ≈ everything outside the V8 managed heap + accounted external.
      const nativeApprox = Math.max(
        0,
        m.rss - m.heapTotal - (m.external ?? 0),
      );
      appendFileSync(
        file,
        JSON.stringify({
          t: Date.now(),
          phase,
          pid: process.pid,
          ppid: process.ppid,
          role,
          rss: m.rss,
          heapTotal: m.heapTotal,
          heapUsed: m.heapUsed,
          external: m.external ?? 0,
          arrayBuffers: m.arrayBuffers ?? 0,
          nativeApprox,
          heapSizeLimit: h.heap_size_limit,
          mallocedMemory: h.malloced_memory,
          argv: process.argv.slice(1, 4).join(' ').slice(0, 120),
        }) + '\n',
      );
    } catch {
      /* best-effort; never disrupt the host process */
    }
  };

  sample('start');
  const timer = setInterval(() => sample('tick'), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  process.once('beforeExit', () => sample('beforeExit'));
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
      sample(sig);
    });
  }

  // SIGUSR2 -> write a heap snapshot for this process (analyze the V8 heap).
  process.on('SIGUSR2', () => {
    try {
      const snap = join(dir, `${role}-${process.pid}-${Date.now()}.heapsnapshot`);
      v8.writeHeapSnapshot(snap);
      appendFileSync(file, JSON.stringify({ t: Date.now(), phase: 'heapsnapshot', pid: process.pid, role, snap }) + '\n');
    } catch {
      /* best-effort */
    }
  });
}

function deriveRole() {
  if (process.env.VETRA_MEM_ROLE) return process.env.VETRA_MEM_ROLE;
  const a = process.argv.join(' ');
  if (/--input-type=module/.test(a)) return 'pglite-initdb';
  if (/\bmain\.(ts|js)\b/.test(a)) return 'agent-main';
  if (/ph-cli\/dist\/cli|@powerhousedao\/ph-cli/.test(a)) return 'reactor-project';
  if (/\bvite\b|vite\/bin|vite\.js/.test(a)) return 'vite';
  if (/connect-server/.test(a)) return 'connect';
  if (/ph-registry|verdaccio/.test(a)) return 'registry';
  if (/tsx\/dist\/cli/.test(a)) return 'tsx-loader';
  return 'node-other';
}
