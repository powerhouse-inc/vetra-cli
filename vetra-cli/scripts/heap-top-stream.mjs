/**
 * Aggregate a large V8 .heapsnapshot by self-size per type and type:name,
 * STREAMING — for snapshots too big for JSON.parse/readFileSync (>512 MB).
 * Usage: node scripts/heap-top-stream.mjs <file.heapsnapshot> [topN]
 *
 * Snapshot format:
 *   {"snapshot":{"meta":{node_fields,node_types,...},...},
 *    "nodes":[ints...],"edges":[...],"strings":["..."]}
 * We never hold the whole file as one string. A single forward scan over the
 * UTF-8 stream locates each needed section by key token, then consumes its
 * value incrementally: `meta` (small object, balanced-brace capture + JSON
 * parse), `nodes` (flat int array, parsed to a number array), `strings`
 * (string array, parsed for name resolution). Self-size sum ≈ total heap;
 * this is self-size not retained-size, but enough to point at big holders.
 */
import { createReadStream } from 'node:fs';

const file = process.argv[2];
const topN = Number.parseInt(process.argv[3] ?? '25', 10);
if (!file) {
  console.error('usage: node heap-top-stream.mjs <file.heapsnapshot> [topN]');
  process.exit(1);
}

const KEY_META = '"meta":';
const KEY_NODES = '"nodes":';
const KEY_STRINGS = '"strings":';

const nodes = []; // flat ints
const stringsArr = [];
let meta = null;

let phase = 'seek';
let metaDone = false;
let nodesDone = false;
let stringsDone = false;
let buf = '';

// meta: balanced-brace object capture
let metaDepth = 0;
let metaText = '';
function feedMeta(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    metaText += s[i];
    if (c === 123) metaDepth++;
    else if (c === 125) {
      metaDepth--;
      if (metaDepth === 0) return i + 1;
    }
  }
  return -1;
}

// nodes: flat int array (no strings inside, so no quote handling needed)
let intSign = 1;
let intVal = 0;
let inInt = false;
function feedNodes(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      intVal = intVal * 10 + (c - 48);
      inInt = true;
    } else if (c === 45) {
      intSign = -1;
      inInt = true;
    } else {
      if (inInt) {
        nodes.push(intSign * intVal);
        intVal = 0;
        intSign = 1;
        inInt = false;
      }
      if (c === 93) return i + 1; // ']'
    }
  }
  return -1;
}

// strings: array of JSON strings
let sIn = false;
let sEsc = false;
let sCur = '';
let sUni = '';
let sUniLeft = 0;
function feedStrings(s) {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    if (sIn) {
      if (sUniLeft > 0) {
        sUni += ch;
        if (--sUniLeft === 0) sCur += String.fromCharCode(parseInt(sUni, 16));
        continue;
      }
      if (sEsc) {
        sEsc = false;
        switch (ch) {
          case 'n': sCur += '\n'; break;
          case 't': sCur += '\t'; break;
          case 'r': sCur += '\r'; break;
          case 'b': sCur += '\b'; break;
          case 'f': sCur += '\f'; break;
          case 'u': sUni = ''; sUniLeft = 4; break;
          default: sCur += ch;
        }
        continue;
      }
      if (c === 92) { sEsc = true; continue; }
      if (c === 34) { stringsArr.push(sCur); sCur = ''; sIn = false; continue; }
      sCur += ch;
    } else {
      if (c === 34) { sIn = true; continue; }
      if (c === 93) return i + 1; // ']'
    }
  }
  return -1;
}

const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });

function onChunk(chunk) {
  buf += chunk;
  let progressed = true;
  while (progressed) {
    progressed = false;
    if (phase === 'seek') {
      let target;
      if (!metaDone) target = KEY_META;
      else if (!nodesDone) target = KEY_NODES;
      else if (!stringsDone) target = KEY_STRINGS;
      else { stream.destroy(); return; }
      const idx = buf.indexOf(target);
      if (idx >= 0) {
        buf = buf.slice(idx + target.length);
        phase = target === KEY_META ? 'meta' : target === KEY_NODES ? 'nodes' : 'strings';
        progressed = true;
      } else {
        // retain a tail long enough to catch a split key token
        if (buf.length > target.length) buf = buf.slice(buf.length - target.length);
      }
    } else if (phase === 'meta') {
      const used = feedMeta(buf);
      if (used >= 0) {
        meta = JSON.parse(metaText.slice(metaText.indexOf('{')));
        metaDone = true;
        buf = buf.slice(used);
        phase = 'seek';
        progressed = true;
      } else buf = '';
    } else if (phase === 'nodes') {
      const used = feedNodes(buf);
      if (used >= 0) {
        nodesDone = true;
        buf = buf.slice(used);
        phase = 'seek';
        progressed = true;
      } else buf = '';
    } else if (phase === 'strings') {
      const used = feedStrings(buf);
      if (used >= 0) {
        stringsDone = true;
        buf = '';
        phase = 'done';
        stream.destroy();
        return;
      } else buf = '';
    }
  }
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  aggregate();
}

stream.on('data', onChunk);
stream.on('close', finish);
stream.on('end', finish);
stream.on('error', (e) => { console.error(e); process.exit(1); });

function aggregate() {
  if (!meta) { console.error('failed to parse meta'); process.exit(1); }
  const { node_fields, node_types } = meta;
  const fieldCount = node_fields.length;
  const typeIdx = node_fields.indexOf('type');
  const nameIdx = node_fields.indexOf('name');
  const selfSizeIdx = node_fields.indexOf('self_size');
  const typeNames = node_types[typeIdx];

  const byName = new Map();
  const byType = new Map();
  let total = 0;
  const nodeCount = Math.floor(nodes.length / fieldCount);
  for (let n = 0; n < nodeCount; n++) {
    const base = n * fieldCount;
    const type = typeNames[nodes[base + typeIdx]];
    const size = nodes[base + selfSizeIdx];
    total += size;
    byType.set(type, (byType.get(type) ?? 0) + size);
    const name = stringsArr[nodes[base + nameIdx]] ?? '';
    const key = `${type}:${name}`;
    byName.set(key, (byName.get(key) ?? 0) + size);
  }
  const mb = (b) => (b / 1048576).toFixed(1);
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  console.log(`total heap self-size: ${mb(total)}MB across ${nodeCount} nodes`);
  console.log(`(strings: ${stringsArr.length}, node ints: ${nodes.length})\n`);
  console.log('=== by node type ===');
  for (const [t, s] of top(byType)) console.log(`${mb(s).padStart(8)}MB  ${t}`);
  console.log('\n=== by type:name (top holders) ===');
  for (const [k, s] of top(byName)) console.log(`${mb(s).padStart(8)}MB  ${k}`);
}
