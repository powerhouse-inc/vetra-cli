/**
 * Aggregate a V8 allocation sampling profile (.heapprofile from the reporter's
 * SIGUSR2 dump) by function — which functions allocate the most memory.
 * Usage: node scripts/alloc-top.mjs <file.heapprofile> [topN]
 *
 * The profile is a tree of nodes { callFrame:{functionName,url,lineNumber},
 * selfSize, children }. selfSize is bytes sampled as allocated by that exact
 * frame. We sum self by frame (function @ url:line) for "top self-allocators",
 * and also sum total (self + descendants) by function for "top inclusive".
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const topN = Number.parseInt(process.argv[3] ?? '30', 10);
if (!file) {
  console.error('usage: node alloc-top.mjs <file.heapprofile> [topN]');
  process.exit(1);
}
const prof = JSON.parse(readFileSync(file, 'utf8'));
const head = prof.head ?? prof; // tolerate {head} or bare head

const self = new Map();
const total = new Map();
const key = (cf) => {
  const fn = cf.functionName || '(anonymous)';
  const loc = cf.url ? `${cf.url.replace(/.*\/node_modules\//, '')}:${cf.lineNumber}` : '';
  return loc ? `${fn}  ${loc}` : fn;
};
let grand = 0;

function walk(node) {
  const k = key(node.callFrame);
  const s = node.selfSize || 0;
  grand += s;
  self.set(k, (self.get(k) ?? 0) + s);
  let sub = s;
  for (const c of node.children || []) sub += walk(c);
  total.set(k, (total.get(k) ?? 0) + sub);
  return sub;
}
walk(head);

const kb = (b) => (b / 1024).toFixed(0);
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);

console.log(`total sampled allocations: ${(grand / 1048576).toFixed(1)} MB\n`);
console.log('=== top SELF allocators (function that directly allocated) ===');
for (const [k, v] of top(self)) console.log(`${(kb(v) + ' KB').padStart(10)}  ${k}`);
console.log('\n=== top INCLUSIVE (function + everything it called) ===');
for (const [k, v] of top(total)) console.log(`${(kb(v) + ' KB').padStart(10)}  ${k}`);
