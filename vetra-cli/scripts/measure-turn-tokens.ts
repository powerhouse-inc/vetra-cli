#!/usr/bin/env tsx
/**
 * Measure the per-step token cost of one agent turn.
 *
 * Runs one scripted build prompt through the real Vetra agent
 * (`vetra-agent-run` in a fresh temp workdir), sums the per-step usage of
 * every `step-finish` chunk, and prints one JSON object: totals, per-step
 * mean, the per-step series, and the tool calls made.
 *
 *   OPENROUTER_API_KEY=… npx tsx vetra-cli/scripts/measure-turn-tokens.ts [--prompt …] [--maxWallMs …] [--keep]
 *
 * Model: VETRA_MODEL (default deepseek/deepseek-v4.1-flash-1017);
 * fallbacks: VETRA_MODEL_FALLBACKS (default `none`, so runs stay comparable).
 * Costs real OpenRouter credits. The key is only passed through the child's
 * environment and is never printed.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI_PATH = path.join(ROOT, 'src', 'main.ts');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

export const DEFAULT_PROMPT =
  'Build a todo list app with a title, due date and done flag; editor with add, complete and delete';
const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
const DEFAULT_WALL_MS = 25 * 60 * 1000;

interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

interface Chunk {
  type: string;
  usage?: Partial<Record<keyof Usage, number>>;
  toolName?: string;
  error?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Never let a key reach the output, even if a child log echoes it. */
function redact(text: string): string {
  let out = text;
  for (const k of [process.env.OPENROUTER_API_KEY, process.env.VETRA_OPENROUTER_API_KEY]) {
    if (k?.trim()) out = out.split(k.trim()).join('[redacted]');
  }
  return out.replace(/sk-or-[A-Za-z0-9_-]+/g, '[redacted]');
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim() && !process.env.VETRA_OPENROUTER_API_KEY?.trim()) {
    throw new Error('set OPENROUTER_API_KEY (or VETRA_OPENROUTER_API_KEY)');
  }
  const prompt = arg('prompt') ?? DEFAULT_PROMPT;
  const maxWallMs = Number(arg('maxWallMs') ?? DEFAULT_WALL_MS);
  const keep = process.argv.includes('--keep');
  const model = process.env.VETRA_MODEL?.trim() || DEFAULT_MODEL;
  const fallbacks = process.env.VETRA_MODEL_FALLBACKS?.trim() || 'none';

  const workdir = mkdtempSync(path.join(tmpdir(), 'vetra-measure-'));
  writeFileSync(path.join(workdir, 'powerhouse.config.json'), '{}\n');
  process.stderr.write(`[measure] workdir ${workdir}, model ${model}, fallbacks ${fallbacks}\n`);

  const started = Date.now();
  const chunks: Chunk[] = [];
  let stderrTail = '';
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      TSX,
      [
        CLI_PATH, '-w', workdir, 'vetra-agent-run',
        '--prompt', prompt,
        // Observational memory is thread-scoped: a turn needs a thread.
        '--threadId', `measure-${Date.now()}`,
        '--maxWallMs', String(maxWallMs),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, VETRA_MODEL: model, VETRA_MODEL_FALLBACKS: fallbacks },
      },
    );
    let pending = '';
    child.stdout.on('data', (d: Buffer) => {
      pending += d.toString();
      let nl = pending.indexOf('\n');
      while (nl !== -1) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        nl = pending.indexOf('\n');
        if (!line.startsWith('{')) continue;
        try {
          const chunk = JSON.parse(line) as Chunk;
          chunks.push(chunk);
          if (chunk.type === 'tool-call' || chunk.type === 'step-finish' || chunk.type === 'error') {
            const detail = chunk.type === 'step-finish' ? str(chunk.usage?.inputTokens) : str(chunk.toolName ?? chunk.error);
            process.stderr.write(`[measure] ${chunk.type} ${redact(detail).slice(0, 200)}\n`);
          }
        } catch {
          /* non-JSON progress line */
        }
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', resolve);
  });

  const steps: Usage[] = chunks
    .filter((c) => c.type === 'step-finish' && c.usage)
    .map((c) => ({
      inputTokens: c.usage?.inputTokens ?? 0,
      cachedInputTokens: c.usage?.cachedInputTokens ?? 0,
      outputTokens: c.usage?.outputTokens ?? 0,
    }));
  const totals = steps.reduce<Usage>(
    (t, s) => ({
      inputTokens: t.inputTokens + s.inputTokens,
      cachedInputTokens: t.cachedInputTokens + s.cachedInputTokens,
      outputTokens: t.outputTokens + s.outputTokens,
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  );
  const mean = (k: keyof Usage) => (steps.length ? Math.round(totals[k] / steps.length) : 0);
  const toolCalls = chunks.filter((c) => c.type === 'tool-call').map((c) => str(c.toolName));
  const toolErrors = chunks
    .filter((c) => c.type === 'tool-result' && c.isError)
    .map((c) => str(c.toolName));
  // Ordered opening of the turn: assistant text (merged deltas) and tool calls
  // with truncated args — enough to see whether the agent built or asked.
  const opening: string[] = [];
  for (const c of chunks) {
    if (opening.length >= 12) break;
    if (c.type === 'text-delta') {
      const last = opening.length - 1;
      if (last >= 0 && opening[last].startsWith('text: ')) opening[last] += str(c.text);
      else opening.push(`text: ${str(c.text)}`);
    } else if (c.type === 'tool-call') {
      opening.push(`tool: ${str(c.toolName)} ${str(c.args ?? c.input).slice(0, 160)}`);
    }
  }
  const errors = chunks.filter((c) => c.type === 'error').map((c) => redact(str(c.error)).slice(0, 300));

  const result = {
    prompt,
    model,
    fallbacks,
    exitCode: code,
    elapsedMs: Date.now() - started,
    steps: steps.length,
    totals,
    perStepMean: {
      inputTokens: mean('inputTokens'),
      cachedInputTokens: mean('cachedInputTokens'),
      outputTokens: mean('outputTokens'),
    },
    firstStepInputTokens: steps[0]?.inputTokens ?? 0,
    perStepInputTokens: steps.map((s) => s.inputTokens),
    toolCalls,
    toolErrors,
    previewShown: toolCalls.includes('spec-preview-show'),
    opening: opening.map((o) => redact(o).slice(0, 1200)),
    errors,
    ...(code !== 0 ? { stderrTail: redact(stderrTail.slice(-1500)) } : {}),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (keep) process.stderr.write(`[measure] kept workdir ${workdir}\n`);
  else rmSync(workdir, { recursive: true, force: true });
}

main().catch((err: unknown) => {
  process.stderr.write(`[measure] ${err instanceof Error ? err.message : str(err)}\n`);
  process.exit(1);
});
