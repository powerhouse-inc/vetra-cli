/**
 * Aggregate a V8 .heapsnapshot by retained size per constructor/type.
 * Usage: node scripts/heap-top.mjs <file.heapsnapshot> [topN]
 *
 * Heap snapshots are a flat node array; we sum self-size by node name and by
 * node type to show what dominates the V8 heap (which constructors/strings/
 * arrays hold the bytes). Self-size sum ≈ total heap; not retained-size (which
 * needs dominator-tree analysis) but enough to point at the big holders.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const topN = Number.parseInt(process.argv[3] ?? '25', 10);
if (!file) {
  console.error('usage: node heap-top.mjs <file.heapsnapshot> [topN]');
  process.exit(1);
}
const snap = JSON.parse(readFileSync(file, 'utf8'));
const { node_fields, node_types } = snap.snapshot.meta;
const nodes = snap.nodes;
const strings = snap.strings;
const fieldCount = node_fields.length;
const typeIdx = node_fields.indexOf('type');
const nameIdx = node_fields.indexOf('name');
const selfSizeIdx = node_fields.indexOf('self_size');
const typeNames = node_types[typeIdx]; // array of type strings

const byName = new Map();
const byType = new Map();
let total = 0;
for (let i = 0; i < nodes.length; i += fieldCount) {
  const type = typeNames[nodes[i + typeIdx]];
  const size = nodes[i + selfSizeIdx];
  total += size;
  byType.set(type, (byType.get(type) ?? 0) + size);
  // name only meaningful for objects/closures/etc.
  const name = strings[nodes[i + nameIdx]] ?? '';
  const key = `${type}:${name}`;
  byName.set(key, (byName.get(key) ?? 0) + size);
}
const mb = (b) => (b / 1048576).toFixed(1);
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);

console.log(`total heap self-size: ${mb(total)}MB across ${nodes.length / fieldCount} nodes\n`);
console.log('=== by node type ===');
for (const [t, s] of top(byType)) console.log(`${mb(s).padStart(8)}MB  ${t}`);
console.log('\n=== by type:name (top holders) ===');
for (const [k, s] of top(byName)) console.log(`${mb(s).padStart(8)}MB  ${k}`);
