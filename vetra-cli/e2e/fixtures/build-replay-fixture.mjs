// Derive a deterministic replay fixture from a recorded VetraAgent session log.
//
//   node e2e/fixtures/build-replay-fixture.mjs <session-log.md> [out.json]
//
// Keeps only the build-affecting tool calls (drops skill/ls/read_file and any
// call whose recorded result was an error — e.g. a failed-then-retried
// spec-update), in order, with their full inputs. The replay agent
// (src/agents/replay-agent.ts) executes these against a real reactor.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const logPath =
  process.argv[2] ??
  "/Users/acaldas/dev/powerhouse/vetra/vetra-test/.ph/vetra/logs/VetraAgent/20260616_1707_001.md";
const outPath = process.argv[3] ?? path.join(here, "todo-list.replay.json");

// Tools that don't mutate the build — never replayed.
const SKIP_TOOLS = new Set([
  "skill",
  "skill_read",
  "reactor-project-ls",
  "reactor-project-ps",
  "mastra_workspace_read_file",
]);

const lines = readFileSync(logPath, "utf8").split("\n");

/** Read a fenced block (``` or ```` …) starting at lines[i] being the opening
 * fence; returns { text, next } where next is the line after the close. */
function readFence(i) {
  const open = lines[i].match(/^(`{3,})/);
  if (!open) return null;
  const ticks = open[1];
  const body = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    if (lines[j].startsWith(ticks) && lines[j].trim() === ticks) break;
    body.push(lines[j]);
  }
  return { text: body.join("\n"), next: j + 1 };
}

/** Find the first fenced JSON block within [i, end) and parse it. */
function jsonBlockBetween(i, end) {
  for (let k = i; k < end; k++) {
    if (/^`{3,}json\s*$/.test(lines[k])) {
      const fence = readFence(k);
      if (!fence) return null;
      try {
        return JSON.parse(fence.text);
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Index every section header.
const sections = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^## (Tool Use|Tool Result): (.+)$/);
  if (m) sections.push({ kind: m[1], tool: m[2].trim(), start: i });
}
for (let s = 0; s < sections.length; s++) {
  sections[s].end = s + 1 < sections.length ? sections[s + 1].start : lines.length;
}

function callIdIn(sec) {
  for (let k = sec.start; k < sec.end; k++) {
    const m = lines[k].match(/^\*\*Call ID\*\*:\s*(\S+)/);
    if (m) return m[1];
  }
  return null;
}
function isErrorResult(sec) {
  for (let k = sec.start; k < sec.end; k++) {
    if (/^\*\*Error\*\*:/.test(lines[k])) return true;
  }
  return false;
}

// callId -> errored?
const errored = new Map();
for (const sec of sections) {
  if (sec.kind === "Tool Result") {
    const id = callIdIn(sec);
    if (id) errored.set(id, isErrorResult(sec));
  }
}

const steps = [];
for (const sec of sections) {
  if (sec.kind !== "Tool Use") continue;
  if (SKIP_TOOLS.has(sec.tool)) continue;
  const id = callIdIn(sec);
  if (id && errored.get(id) === true) continue; // failed call (was retried)
  const args = jsonBlockBetween(sec.start, sec.end) ?? {};
  steps.push({ tool: sec.tool, args });
}

const fixture = {
  name: "todo-list",
  prompt: "Create a minimal todo list",
  source: path.basename(logPath),
  steps,
  done: "Done. Built the todo-list document model, editor, and a preview with three sample todos.",
};

writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${steps.length} steps to ${path.relative(process.cwd(), outPath)}`);
for (const s of steps) console.log(`  - ${s.tool}`);
