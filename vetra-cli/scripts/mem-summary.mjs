/**
 * Summarize a VETRA_MEM_PROFILE_DIR into a per-role memory breakdown.
 * Usage: node scripts/mem-summary.mjs <profile-dir>
 *
 * For each process (role+pid) reports peak RSS and, at that peak sample, the
 * V8-heap-vs-native split — so the dominant native consumers (PGlite, Vite)
 * are visible. Also prints a tree-wide peak (sum of each process's own peak).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node mem-summary.mjs <profile-dir>');
  process.exit(1);
}
const mb = (b) => Math.round(b / 1048576);

const procs = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.jsonl')) continue;
  const lines = readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean);
  const samples = lines.map((l) => JSON.parse(l));
  if (!samples.length) continue;
  const peak = samples.reduce((a, s) => (s.rss > a.rss ? s : a), samples[0]);
  const last = samples[samples.length - 1];
  procs.push({ role: peak.role, pid: peak.pid, peak, last, n: samples.length });
}

procs.sort((a, b) => b.peak.rss - a.peak.rss);

console.log('role               pid     peakRSS   heapUsed  heapTot   native   external  argv');
console.log('-----------------  ------  --------  --------  -------   ------   --------  ----');
let sumPeak = 0;
let sumNative = 0;
for (const p of procs) {
  sumPeak += p.peak.rss;
  sumNative += p.peak.nativeApprox;
  console.log(
    `${p.role.padEnd(17)}  ${String(p.pid).padEnd(6)}  ${(mb(p.peak.rss) + 'MB').padStart(8)}  ` +
      `${(mb(p.peak.heapUsed) + 'MB').padStart(8)}  ${(mb(p.peak.heapTotal) + 'MB').padStart(7)}  ` +
      `${(mb(p.peak.nativeApprox) + 'MB').padStart(6)}  ${(mb(p.peak.external) + 'MB').padStart(8)}  ${p.peak.argv}`,
  );
}
console.log('-----------------');
console.log(`processes: ${procs.length}   sum-of-peaks RSS: ${mb(sumPeak)}MB   native: ${mb(sumNative)}MB   heap: ${mb(sumPeak - sumNative)}MB`);
